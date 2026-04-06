"""
Spark UI Metrics Collector (Race-Condition Safe)
=================================================

Problem: Spark UI at localhost:4040 disappears when spark.stop() is called
Solution: Capture metrics in try...finally BEFORE shutdown

Maps to CMU 15-721 Lecture 06: External Algorithms (spill metrics)
"""

import requests
import time
from contextlib import contextmanager
import json

class SparkMetricsCollector:
    """Safely collect Spark UI metrics before session shutdown."""
    
    def __init__(self, spark_session):
        self.spark = spark_session
        self.app_id = None
        self.ui_url = "http://localhost:4040"
        self.last_metrics = None
        
    @contextmanager
    def capture_metrics_safely(self):
        """
        Context manager ensuring metrics captured BEFORE spark.stop().
        
        Usage:
            collector = SparkMetricsCollector(spark)
            with collector.capture_metrics_safely():
                result = spark.sql(query).collect()
            # Metrics automatically captured in __exit__
            metrics = collector.last_metrics
        """
        
        # Wait for UI to be accessible
        if not self._wait_for_ui():
            print("⚠️  Spark UI not accessible, metrics may be unavailable")
        
        # Get application ID
        try:
            self.app_id = self.spark.sparkContext.applicationId
        except:
            self.app_id = "unknown"
        
        try:
            yield self
        finally:
            # CRITICAL: Scrape metrics BEFORE spark.stop()
            self.last_metrics = self._scrape_metrics_now()
            print("✅ Metrics captured before session shutdown")
    
    def _wait_for_ui(self, timeout=10):
        """Wait for Spark UI to become accessible."""
        start = time.time()
        while time.time() - start < timeout:
            try:
                response = requests.get(f"{self.ui_url}/api/v1/applications", timeout=2)
                if response.status_code == 200:
                    print(f"✅ Spark UI accessible at {self.ui_url}")
                    return True
            except:
                time.sleep(0.5)
        
        print(f"⚠️  Spark UI not accessible at {self.ui_url}")
        return False
    
    def _scrape_metrics_now(self):
        """
        Scrape ALL metrics immediately while UI is still alive.
        
        This runs in finally block BEFORE spark.stop().
        Returns spill metrics for external merge sort analysis.
        """
        
        try:
            # Get all stages
            stages_url = f"{self.ui_url}/api/v1/applications/{self.app_id}/stages"
            stages_response = requests.get(stages_url, timeout=5)
            
            if stages_response.status_code != 200:
                return self._fallback_metrics("Failed to fetch stages")
            
            stages_data = stages_response.json()
            
            # Aggregate spill metrics across all stages
            total_memory_spill = 0
            total_disk_spill = 0
            spill_events = 0
            max_partition_size = 0
            
            for stage in stages_data:
                # Memory spills
                if 'memoryBytesSpilled' in stage:
                    memory_spill = stage.get('memoryBytesSpilled', 0)
                    if memory_spill > 0:
                        total_memory_spill += memory_spill
                        spill_events += 1
                
                # Disk spills (the smoking gun!)
                if 'diskBytesSpilled' in stage:
                    disk_spill = stage.get('diskBytesSpilled', 0)
                    if disk_spill > 0:
                        total_disk_spill += disk_spill
                
                # Partition sizes (for skew detection)
                if 'outputBytes' in stage:
                    max_partition_size = max(max_partition_size, stage.get('outputBytes', 0))
            
            # Build metrics dictionary
            metrics = {
                'memory_spill_bytes': total_memory_spill,
                'disk_spill_bytes': total_disk_spill,
                'spill_events': spill_events,
                'external_merge_occurred': total_disk_spill > 0,
                'max_partition_size_bytes': max_partition_size,
                'demonstrates': self._interpret_spills(total_disk_spill),
                'maps_to': 'CMU 15-721 Lecture 06: External Merge Sort' if total_disk_spill > 0 else 'In-memory processing',
                'timestamp': time.time(),
                'status': 'success'
            }
            
            # Log findings
            if metrics['external_merge_occurred']:
                print(f"🎯 SPILL DETECTED: {total_disk_spill / (1024**2):.1f} MB spilled to disk")
                print(f"   External merge sort in action! (15-721 Lecture 06)")
            else:
                print(f"✅ No spills: Query stayed in-memory")
            
            return metrics
            
        except Exception as e:
            return self._fallback_metrics(f"Scraping failed: {e}")
    
    def _interpret_spills(self, disk_spill_bytes):
        """Interpret what the spill metrics mean."""
        if disk_spill_bytes == 0:
            return "Query executed entirely in-memory (no external algorithms needed)"
        elif disk_spill_bytes < 100 * 1024**2:  # < 100MB
            return "Minor spill to disk (external merge sort with small working set)"
        elif disk_spill_bytes < 1024**3:  # < 1GB
            return "Moderate spill to disk (external merge sort active)"
        else:  # >= 1GB
            return "Heavy spill to disk (significant external merge sort activity)"
    
    def _fallback_metrics(self, reason):
        """Return safe fallback metrics if scraping fails."""
        print(f"⚠️  Metrics unavailable: {reason}")
        return {
            'error': reason,
            'memory_spill_bytes': 0,
            'disk_spill_bytes': 0,
            'spill_events': 0,
            'external_merge_occurred': False,
            'note': 'Metrics unavailable - UI may have been inaccessible',
            'status': 'fallback',
            'timestamp': time.time()
        }
    
    def save_metrics(self, filepath):
        """Save metrics to JSON file."""
        if self.last_metrics:
            with open(filepath, 'w') as f:
                json.dump(self.last_metrics, f, indent=2)
            print(f"💾 Metrics saved: {filepath}")

# Example usage
def benchmark_with_metrics(spark, query):
    """
    Run Spark query with guaranteed metrics capture.
    
    Returns:
        {
            'execution_time': float,
            'spill_metrics': dict,
            'result_count': int
        }
    """
    
    collector = SparkMetricsCollector(spark)
    
    # Use context manager to ensure metrics captured before shutdown
    with collector.capture_metrics_safely():
        start = time.time()
        result = spark.sql(query).collect()
        execution_time = time.time() - start
    
    # Metrics captured, safe to return
    return {
        'execution_time': execution_time,
        'spill_metrics': collector.last_metrics,
        'result_count': len(result)
    }

if __name__ == '__main__':
    # Test metrics collector
    import sys
    from pathlib import Path
    sys.path.append(str(Path(__file__).parent.parent))
    from config.spark_config import get_spark_session
    
    spark = get_spark_session()
    
    # Test query
    collector = SparkMetricsCollector(spark)
    
    with collector.capture_metrics_safely():
        # Run simple query
        spark.range(1000).selectExpr("id * 2 as doubled").collect()
    
    print("\n📊 Collected metrics:")
    print(json.dumps(collector.last_metrics, indent=2))
    
    spark.stop()
