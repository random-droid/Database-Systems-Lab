"""
Advanced Benchmark Timer
=========================

Features:
1. CPU vs IO time breakdown (detect IO-bound external merge)
2. Cold vs Hot scan testing (buffer pool effects)
3. Memory tracking

Maps to CMU 15-721:
- Lecture 05: Buffer Pool Management (cold vs hot)
- Lecture 06: External Algorithms (CPU vs IO breakdown)
"""

import time
import threading
import psutil
import os

class BenchmarkTimer:
    """Advanced timer for database benchmarks."""
    
    def __init__(self):
        self.process = psutil.Process(os.getpid())

    def _monitor_peak_memory(self, stop_event, peak_holder, interval=0.05):
        """
        Background thread that polls RSS every *interval* seconds and records
        the maximum observed value into peak_holder[0].
        """
        while not stop_event.is_set():
            try:
                rss_mb = self.process.memory_info().rss / (1024 ** 2)
                if rss_mb > peak_holder[0]:
                    peak_holder[0] = rss_mb
            except Exception:
                pass
            stop_event.wait(interval)

    def benchmark_with_io_breakdown(self, query_func, system_name=""):
        """
        Measure execution with CPU vs IO breakdown.
        
        Returns:
            {
                'total_time_seconds': float,
                'cpu_time_seconds': float,
                'io_wait_seconds': float,
                'cpu_bound_percent': float,
                'io_bound_percent': float,
                'peak_memory_mb': float,   # true peak RSS during query
                'memory_increase_mb': float,
                'interpretation': str
            }
        """
        
        # Start metrics
        start_wall = time.time()
        start_cpu = self.process.cpu_times()
        start_memory = self.process.memory_info().rss / (1024**2)  # MB

        # Start background memory monitor
        stop_event = threading.Event()
        peak_holder = [start_memory]
        monitor_thread = threading.Thread(
            target=self._monitor_peak_memory,
            args=(stop_event, peak_holder),
            daemon=True,
        )
        monitor_thread.start()

        try:
            # Run query
            result = query_func()
        finally:
            # Stop monitor
            stop_event.set()
            monitor_thread.join(timeout=1)
        
        # End metrics
        end_wall = time.time()
        end_cpu = self.process.cpu_times()
        end_memory = self.process.memory_info().rss / (1024**2)  # MB

        # Final poll to capture any last-moment spike
        if end_memory > peak_holder[0]:
            peak_holder[0] = end_memory

        peak_memory = peak_holder[0]

        # Calculate breakdown
        total_time = end_wall - start_wall
        cpu_time = (end_cpu.user - start_cpu.user) + (end_cpu.system - start_cpu.system)
        io_wait = total_time - cpu_time
        
        cpu_percent = (cpu_time / total_time * 100) if total_time > 0 else 0
        io_percent = (io_wait / total_time * 100) if total_time > 0 else 0
        
        # Interpret bottleneck
        interpretation = self._interpret_bottleneck(cpu_percent)
        
        metrics = {
            'total_time_seconds': round(total_time, 3),
            'cpu_time_seconds': round(cpu_time, 3),
            'io_wait_seconds': round(io_wait, 3),
            'cpu_bound_percent': round(cpu_percent, 1),
            'io_bound_percent': round(io_percent, 1),
            'peak_memory_mb': round(peak_memory, 1),
            'memory_increase_mb': round(peak_memory - start_memory, 1),
            'interpretation': interpretation,
            'demonstrates': self._get_demonstration(cpu_percent),
            'system': system_name
        }
        
        # Log findings
        if io_percent > 50:
            print(f"🎯 IO-BOUND detected: {io_percent:.1f}% IO wait")
            print(f"   External merge sort likely active (15-721 Lecture 06)")
        else:
            print(f"✅ CPU-BOUND: {cpu_percent:.1f}% CPU utilization")
            print(f"   In-memory processing (vectorized execution)")
        
        return metrics
    
    def benchmark_cold_and_hot(self, query_func, system_name="", clear_cache=True):
        """
        Run query twice to measure buffer pool effects.
        
        Run 1 (COLD): Disk I/O + computation (buffer pool empty)
        Run 2 (HOT): Cached computation only (buffer pool warm)
        
        Maps to CMU 15-721 Lecture 05: Buffer Pool Management
        """
        
        # COLD RUN: Clear caches first (best effort)
        if clear_cache:
            self._clear_os_cache()
        
        print(f"\n🧊 COLD RUN (buffer pool empty):")
        start = time.time()
        query_func()
        cold_time = time.time() - start
        print(f"   Time: {cold_time:.3f}s")
        
        # Small delay to ensure completion
        time.sleep(0.5)
        
        # HOT RUN: Immediate re-run (cached)
        print(f"🔥 HOT RUN (buffer pool warm):")
        start = time.time()
        query_func()
        hot_time = time.time() - start
        print(f"   Time: {hot_time:.3f}s")
        
        # Calculate speedup
        speedup = cold_time / hot_time if hot_time > 0 else 1
        
        result = {
            'cold': {
                'time_seconds': round(cold_time, 3),
                'cache_state': 'empty',
                'includes': 'disk I/O + computation'
            },
            'hot': {
                'time_seconds': round(hot_time, 3),
                'cache_state': 'warm',
                'includes': 'computation only (cached data)'
            },
            'speedup': round(speedup, 2),
            'demonstrates': 'Buffer Pool Management (CMU 15-721 Lecture 05)',
            'system': system_name
        }
        
        # Log findings
        if speedup > 3:
            print(f"🎯 SIGNIFICANT BUFFER POOL EFFECT: {speedup:.1f}x speedup")
            print(f"   Cold run was {speedup:.1f}x slower due to disk I/O")
        else:
            print(f"✅ Minimal buffer pool effect: {speedup:.1f}x speedup")
            print(f"   Query may be computation-bound or data already cached")
        
        return result
    
    def _interpret_bottleneck(self, cpu_percent):
        """Interpret what the CPU percentage means."""
        if cpu_percent > 80:
            return "CPU-bound: In-memory processing, vectorization working efficiently"
        elif cpu_percent > 50:
            return "Mixed: Some in-memory work, some I/O operations"
        elif cpu_percent > 20:
            return "IO-bound: External merge sort active, disk operations dominate"
        else:
            return "Heavily IO-bound: Significant disk activity, possible external sorting"
    
    def _get_demonstration(self, cpu_percent):
        """Get what this demonstrates from 15-721."""
        if cpu_percent > 70:
            return "Vectorized execution (15-721 Lecture 07)"
        else:
            return "External merge sort under memory pressure (15-721 Lecture 06)"
    
    def _clear_os_cache(self):
        """
        Clear OS page cache (best effort on Replit).
        Requires sudo on Linux, so may not work in Replit.
        """
        try:
            # Try to clear Linux page cache
            os.system('sync')
            os.system('echo 3 > /proc/sys/vm/drop_caches 2>/dev/null')
        except:
            # If no permissions, just add delay
            print("   (OS cache clear skipped - no sudo)")
            time.sleep(2)

# Convenience function
def time_query(func, system_name="", include_cold_hot=False):
    """
    Time a query with full metrics.
    
    Args:
        func: Query function to execute
        system_name: Name of database system
        include_cold_hot: Whether to run cold/hot test
    
    Returns:
        dict with timing metrics
    """
    
    timer = BenchmarkTimer()
    
    # Basic timing with CPU/IO breakdown
    metrics = timer.benchmark_with_io_breakdown(func, system_name)
    
    # Optionally add cold/hot test
    if include_cold_hot:
        cold_hot = timer.benchmark_cold_and_hot(func, system_name)
        metrics['cold_hot'] = cold_hot
    
    return metrics

class PeakMemoryCapture:
    """
    Lightweight context manager / callable wrapper that records peak RSS memory
    for benchmark scripts that don't use BenchmarkTimer's full timing machinery.

    Usage (context manager):
        capture = PeakMemoryCapture()
        with capture:
            run_heavy_benchmark()
        result["peak_memory_mb"] = capture.peak_memory_mb

    Usage (inline injection into an existing result dict):
        inject_peak_memory(result_dict)   # adds peak_memory_mb to the dict in-place
    """

    _POLL_INTERVAL = 0.05  # seconds

    def __init__(self):
        self._process = psutil.Process(os.getpid())
        self.peak_memory_mb: float = 0.0
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._started = False
        self._stopped = False

    def _poll(self):
        while not self._stop.is_set():
            try:
                rss = self._process.memory_info().rss / (1024 ** 2)
                if rss > self.peak_memory_mb:
                    self.peak_memory_mb = rss
            except Exception:
                pass
            self._stop.wait(self._POLL_INTERVAL)

    def __enter__(self):
        if not self._started:
            self.peak_memory_mb = self._process.memory_info().rss / (1024 ** 2)
            self._stop.clear()
            self._thread = threading.Thread(target=self._poll, daemon=True)
            self._thread.start()
            self._started = True
        return self

    def __exit__(self, *_):
        if self._stopped:
            return
        self._stopped = True
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=1)
        # Final sample
        try:
            rss = self._process.memory_info().rss / (1024 ** 2)
            if rss > self.peak_memory_mb:
                self.peak_memory_mb = rss
        except Exception:
            pass
        return False  # don't suppress exceptions


def inject_peak_memory(result: dict, capture: "PeakMemoryCapture | None" = None) -> dict:
    """
    Add 'peak_memory_mb' to *result* in-place.

    If *capture* is provided, its recorded peak is used.
    Otherwise a fresh one-shot snapshot of current RSS is used as a best-effort fallback.

    Returns *result* for convenient chaining.
    """
    if capture is not None:
        result["peak_memory_mb"] = round(capture.peak_memory_mb, 1)
    else:
        try:
            rss = psutil.Process(os.getpid()).memory_info().rss / (1024 ** 2)
        except Exception:
            rss = 0.0
        result.setdefault("peak_memory_mb", round(rss, 1))
    return result


if __name__ == '__main__':
    # Test the timer
    def dummy_query():
        """Dummy query for testing."""
        time.sleep(0.1)
        return list(range(1000))
    
    print("Testing BenchmarkTimer...")
    print("="*60)
    
    # Test basic timing
    metrics = time_query(dummy_query, "test_system", include_cold_hot=True)
    
    print("\n📊 Results:")
    print(f"   Total time: {metrics['total_time_seconds']}s")
    print(f"   CPU time: {metrics['cpu_time_seconds']}s")
    print(f"   IO wait: {metrics['io_wait_seconds']}s")
    print(f"   Cold/Hot speedup: {metrics['cold_hot']['speedup']}x")
