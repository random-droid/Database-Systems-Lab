"""
Use Case 2: Complex Analytical Joins
=====================================

3-table join on 50M × 1M × 10K rows.

The MONEY BENCHMARK: Forces spill-to-disk on Replit's 2GB RAM.

Maps to CMU 15-721:
- Lecture 09: Join Algorithms (broadcast vs shuffle vs merge)
- Lecture 06: External Algorithms (spill-to-disk when exceeds memory)

Expected Results on 2GB RAM:
- Postgres: Switches to external merge join (temp files)
- DuckDB: Out-of-core processing (may exceed 2GB)
- Spark: Spills shuffle data to disk (visible in UI)
- BigQuery: No spills (elastic memory)
- Databricks: No spills (auto-scales)
"""

import sys
import json
import time
from pathlib import Path

# Add utils to path
sys.path.append(str(Path(__file__).parent.parent))

from config.spark_config import get_spark_session
from utils.spark_metrics import SparkMetricsCollector
from utils.benchmark_timer import BenchmarkTimer

# The query (same for all systems)
QUERY = """
SELECT 
    o.order_id,
    o.order_date,
    o.region,
    o.revenue,
    c.customer_name,
    p.product_name,
    p.category
FROM orders o
JOIN customers c ON o.customer_id = c.customer_id
JOIN products p ON o.product_id = p.product_id
WHERE o.order_date >= '2024-01-01'
    AND o.region IN ('East', 'West')
ORDER BY o.revenue DESC
LIMIT 1000
"""

def benchmark_postgres():
    """
    Benchmark Postgres with work_mem tuning.
    
    Tests different work_mem settings to show when Postgres
    switches from hash join to external merge join.
    """
    
    print("\n" + "="*80)
    print("🐘 POSTGRES: Complex Join Benchmark")
    print("="*80)
    
    import psycopg2
    
    try:
        conn = psycopg2.connect(
            dbname='olap_benchmark',
            user='postgres',
            password='postgres',
            host='localhost'
        )
        cursor = conn.cursor()
    except Exception as e:
        print(f"❌ Postgres connection failed: {e}")
        return None
    
    results = {}
    
    # Test with different work_mem settings
    for work_mem in ['64MB', '256MB', '512MB']:
        print(f"\n📊 Testing with work_mem = {work_mem}")
        
        cursor.execute(f"SET work_mem = '{work_mem}'")
        
        timer = BenchmarkTimer()
        
        # Get EXPLAIN to see join strategy
        cursor.execute(f"EXPLAIN (ANALYZE, BUFFERS, VERBOSE) {QUERY}")
        explain_output = '\n'.join([row[0] for row in cursor.fetchall()])
        
        # Check for temp files (smoking gun for external merge)
        temp_files_used = 'temp' in explain_output.lower()
        uses_merge_join = 'Merge Join' in explain_output
        uses_hash_join = 'Hash Join' in explain_output
        
        # Extract buffer stats
        import re
        temp_read = 0
        temp_written = 0
        
        temp_read_match = re.search(r'temp read=(\d+)', explain_output)
        if temp_read_match:
            temp_read = int(temp_read_match.group(1))
        
        temp_written_match = re.search(r'temp written=(\d+)', explain_output)
        if temp_written_match:
            temp_written = int(temp_written_match.group(1))
        
        # Run actual query with timing
        def run_query():
            cursor.execute(QUERY)
            return cursor.fetchall()
        
        metrics = timer.benchmark_with_io_breakdown(run_query, "postgres")
        
        results[work_mem] = {
            **metrics,
            'work_mem': work_mem,
            'temp_files_used': temp_files_used,
            'temp_read_blocks': temp_read,
            'temp_written_blocks': temp_written,
            'join_strategy': 'Merge Join' if uses_merge_join else 'Hash Join',
            'external_merge': temp_read > 0 or temp_written > 0,
            'demonstrates': 'External merge join (15-721 Lecture 06)' if temp_files_used else 'In-memory hash join'
        }
        
        # Log findings
        if temp_files_used:
            print(f"   🎯 TEMP FILES USED: External merge join!")
            print(f"      Temp read: {temp_read} blocks")
            print(f"      Temp written: {temp_written} blocks")
        else:
            print(f"   ✅ In-memory: Hash join")
    
    conn.close()
    
    return {
        'system': 'postgres',
        'query': 'complex_join',
        'results_by_work_mem': results
    }

def benchmark_duckdb():
    """
    Benchmark DuckDB (should handle out-of-core gracefully).
    """
    
    print("\n" + "="*80)
    print("🦆 DUCKDB: Complex Join Benchmark")
    print("="*80)
    
    import duckdb
    import psutil
    
    conn = duckdb.connect(':memory:')
    
    # Setup external tables
    conn.execute("""
        CREATE VIEW orders AS 
        SELECT * FROM read_parquet('data/sample_data/orders_base_50M.parquet')
    """)
    conn.execute("""
        CREATE VIEW customers AS
        SELECT * FROM read_parquet('data/sample_data/customers.parquet')
    """)
    conn.execute("""
        CREATE VIEW products AS
        SELECT * FROM read_parquet('data/sample_data/products.parquet')
    """)
    
    timer = BenchmarkTimer()
    process = psutil.Process()
    
    # Monitor memory during execution
    initial_memory = process.memory_info().rss / (1024**2)
    
    def run_query():
        return conn.execute(QUERY).fetchall()
    
    # Run with metrics
    metrics = timer.benchmark_with_io_breakdown(run_query, "duckdb")
    
    # Check if exceeded 2GB (out-of-core test)
    peak_memory = metrics['peak_memory_mb']
    out_of_core = peak_memory > 2000
    
    conn.close()
    
    result = {
        'system': 'duckdb',
        'query': 'complex_join',
        **metrics,
        'out_of_core': out_of_core,
        'demonstrates': 'Out-of-core processing (15-721 Lecture 04)' if out_of_core else 'In-memory processing'
    }
    
    if out_of_core:
        print(f"   🎯 OUT-OF-CORE: Peak memory {peak_memory:.1f} MB > 2GB")
        print(f"      DuckDB handled larger-than-memory query!")
    else:
        print(f"   ✅ In-memory: Peak {peak_memory:.1f} MB")
    
    return result

def benchmark_spark():
    """
    Benchmark Spark (expected to spill to disk).
    
    This is the SMOKING GUN for external merge sort.
    """
    
    print("\n" + "="*80)
    print("⚡ SPARK: Complex Join Benchmark (SPILL TEST)")
    print("="*80)
    
    spark = get_spark_session()
    
    # Register tables
    spark.read.parquet('data/sample_data/orders_base_50M.parquet').createOrReplaceTempView('orders')
    spark.read.parquet('data/sample_data/customers.parquet').createOrReplaceTempView('customers')
    spark.read.parquet('data/sample_data/products.parquet').createOrReplaceTempView('products')
    
    collector = SparkMetricsCollector(spark)
    timer = BenchmarkTimer()
    
    # Run query with metrics capture
    with collector.capture_metrics_safely():
        def run_query():
            return spark.sql(QUERY).collect()
        
        metrics = timer.benchmark_with_io_breakdown(run_query, "spark")
    
    # Get spill metrics (captured before spark.stop())
    spill_metrics = collector.last_metrics
    
    # Stop Spark (metrics already captured!)
    spark.stop()
    
    result = {
        'system': 'spark',
        'query': 'complex_join',
        **metrics,
        'spill_metrics': spill_metrics,
        'demonstrates': spill_metrics.get('demonstrates', 'Unknown')
    }
    
    return result

def run_all_systems():
    """Run benchmark on all systems and save results."""
    
    print("\n" + "="*80)
    print(" USE CASE 2: COMPLEX ANALYTICAL JOINS")
    print(" The Spill-to-Disk Stress Test")
    print("="*80)
    print("\nQuery: 3-table join (50M × 1M × 10K rows)")
    print("Expected: Forces spill-to-disk on 2GB RAM")
    print("="*80)
    
    all_results = {}
    
    # Benchmark each system
    try:
        postgres_result = benchmark_postgres()
        if postgres_result:
            all_results['postgres'] = postgres_result
    except Exception as e:
        print(f"❌ Postgres benchmark failed: {e}")
    
    try:
        duckdb_result = benchmark_duckdb()
        all_results['duckdb'] = duckdb_result
    except Exception as e:
        print(f"❌ DuckDB benchmark failed: {e}")
    
    try:
        spark_result = benchmark_spark()
        all_results['spark'] = spark_result
    except Exception as e:
        print(f"❌ Spark benchmark failed: {e}")
    
    # Save results
    output_dir = Path('results')
    output_dir.mkdir(exist_ok=True)
    
    output_file = output_dir / 'use_case_2_complex_joins.json'
    with open(output_file, 'w') as f:
        json.dump(all_results, f, indent=2)
    
    print("\n" + "="*80)
    print(" RESULTS SUMMARY")
    print("="*80)
    
    for system, data in all_results.items():
        print(f"\n{system.upper()}:")
        if system == 'postgres':
            for work_mem, metrics in data['results_by_work_mem'].items():
                print(f"  {work_mem}:")
                print(f"    Time: {metrics['total_time_seconds']}s")
                print(f"    External merge: {metrics['external_merge']}")
                print(f"    CPU/IO: {metrics['cpu_bound_percent']:.1f}% / {metrics['io_bound_percent']:.1f}%")
        else:
            print(f"  Time: {data['total_time_seconds']}s")
            print(f"  CPU/IO: {data['cpu_bound_percent']:.1f}% / {data['io_bound_percent']:.1f}%")
            if 'spill_metrics' in data:
                spill = data['spill_metrics']
                if spill['external_merge_occurred']:
                    print(f"  🎯 SPILL: {spill['disk_spill_bytes'] / (1024**2):.1f} MB to disk")
    
    print(f"\n💾 Full results saved: {output_file}")
    
    return all_results

if __name__ == '__main__':
    results = run_all_systems()
