"""
Use Case 1: Sub-second Dashboard Queries
=========================================

Regional revenue aggregations — the classic BI workload.

Tests: Can each system deliver sub-second responses for dashboard queries?

Maps to CMU 15-721:
- Lecture 07: Vectorized Execution (tuple-at-a-time vs vectorized)
- Lecture 04: Storage Models (NSM vs DSM column store)

Expected Results on 2GB RAM:
- Postgres: Slowest (tuple-at-a-time, row store, full scan)
- DuckDB: Fastest local (vectorized, column store, SIMD)
- Spark: Moderate (overhead from scheduler, but parallel)
"""

import sys
import json
import os
from pathlib import Path

sys.path.append(str(Path(__file__).parent.parent))

from config.spark_config import get_spark_session
from utils.spark_metrics import SparkMetricsCollector
from utils.benchmark_timer import BenchmarkTimer
from utils.concept_validator import ConceptValidator

# The dashboard query — same SQL for all systems
DASHBOARD_QUERY = """
SELECT
    region,
    strftime('%Y-%m', CAST(order_date AS VARCHAR)) AS month,
    COUNT(*) AS order_count,
    SUM(revenue) AS total_revenue,
    AVG(revenue) AS avg_revenue,
    SUM(quantity) AS total_quantity
FROM orders
WHERE order_date >= '2023-01-01'
GROUP BY region, month
ORDER BY month, region
"""

# Postgres uses standard date_trunc syntax
DASHBOARD_QUERY_POSTGRES = """
SELECT
    region,
    to_char(order_date, 'YYYY-MM') AS month,
    COUNT(*) AS order_count,
    SUM(revenue) AS total_revenue,
    AVG(revenue) AS avg_revenue,
    SUM(quantity) AS total_quantity
FROM orders
WHERE order_date >= '2023-01-01'
GROUP BY region, month
ORDER BY month, region
"""

# Spark uses date_format syntax
DASHBOARD_QUERY_SPARK = """
SELECT
    region,
    date_format(order_date, 'yyyy-MM') AS month,
    COUNT(*) AS order_count,
    SUM(revenue) AS total_revenue,
    AVG(revenue) AS avg_revenue,
    SUM(quantity) AS total_quantity
FROM orders
WHERE order_date >= '2023-01-01'
GROUP BY region, month
ORDER BY month, region
"""


def benchmark_postgres():
    """
    Benchmark Postgres on dashboard query.

    Row-store baseline: tuple-at-a-time execution.
    Demonstrates: Why row stores are slower for analytics (full row reads even for aggregations).
    """
    print("\n" + "=" * 80)
    print("POSTGRES: Dashboard Query (Row Store Baseline)")
    print("=" * 80)

    import psycopg2

    try:
        conn = psycopg2.connect(
            dbname=os.getenv("POSTGRES_DB", "olap_benchmark"),
            user=os.getenv("POSTGRES_USER", "postgres"),
            password=os.getenv("POSTGRES_PASSWORD", "postgres"),
            host=os.getenv("POSTGRES_HOST", "localhost"),
            port=os.getenv("POSTGRES_PORT", "5432"),
        )
        cursor = conn.cursor()
    except Exception as e:
        print(f"Postgres connection failed: {e}")
        return None

    timer = BenchmarkTimer()

    # Cold run first (with EXPLAIN for join strategy)
    cursor.execute(f"EXPLAIN (ANALYZE, BUFFERS) {DASHBOARD_QUERY_POSTGRES}")
    explain_lines = [row[0] for row in cursor.fetchall()]
    explain_output = "\n".join(explain_lines)

    # Extract sequential scan vs index scan
    uses_seq_scan = "Seq Scan" in explain_output
    uses_index_scan = "Index Scan" in explain_output

    def run_query():
        cursor.execute(DASHBOARD_QUERY_POSTGRES)
        return cursor.fetchall()

    # Cold and hot runs
    cold_hot = timer.benchmark_cold_and_hot(run_query, "postgres", clear_cache=False)
    io_metrics = timer.benchmark_with_io_breakdown(run_query, "postgres")

    conn.close()

    result = {
        "system": "postgres",
        "query": "dashboard_regional_revenue",
        **io_metrics,
        "cold_hot": cold_hot,
        "scan_strategy": "Sequential Scan" if uses_seq_scan else "Index Scan",
        "demonstrates": "Tuple-at-a-time execution (NSM row store) — CMU 15-721 Lecture 07",
        "maps_to": "CMU 15-721 Lecture 07: Vectorized Execution (baseline comparison)",
    }

    print(f"   Scan strategy: {result['scan_strategy']}")
    print(f"   Time: {io_metrics['total_time_seconds']:.3f}s")
    print(f"   Cold/Hot: {cold_hot['cold']['time_seconds']:.3f}s / {cold_hot['hot']['time_seconds']:.3f}s (x{cold_hot['speedup']:.1f})")

    return result


def benchmark_duckdb():
    """
    Benchmark DuckDB on dashboard query.

    Column-store with vectorized execution and SIMD.
    Demonstrates: DSM column store advantage for analytics.
    """
    print("\n" + "=" * 80)
    print("DUCKDB: Dashboard Query (Vectorized Column Store)")
    print("=" * 80)

    import duckdb

    conn = duckdb.connect(":memory:")

    # Setup external Parquet views (zero-copy)
    conn.execute(
        "CREATE VIEW orders AS SELECT * FROM read_parquet('data/sample_data/orders_base_50M.parquet')"
    )

    timer = BenchmarkTimer()

    def run_query():
        return conn.execute(DASHBOARD_QUERY).fetchall()

    cold_hot = timer.benchmark_cold_and_hot(run_query, "duckdb", clear_cache=False)
    io_metrics = timer.benchmark_with_io_breakdown(run_query, "duckdb")

    conn.close()

    result = {
        "system": "duckdb",
        "query": "dashboard_regional_revenue",
        **io_metrics,
        "cold_hot": cold_hot,
        "demonstrates": "Vectorized execution on column store (SIMD) — CMU 15-721 Lecture 07",
        "maps_to": "CMU 15-721 Lecture 07: Vectorized Execution",
    }

    print(f"   Time: {io_metrics['total_time_seconds']:.3f}s")
    print(f"   Cold/Hot: {cold_hot['cold']['time_seconds']:.3f}s / {cold_hot['hot']['time_seconds']:.3f}s (x{cold_hot['speedup']:.1f})")
    print(f"   CPU/IO: {io_metrics['cpu_bound_percent']:.1f}% / {io_metrics['io_bound_percent']:.1f}%")

    return result


def benchmark_spark():
    """
    Benchmark Spark on dashboard query.

    Distributed vectorized execution with Catalyst optimizer.
    """
    print("\n" + "=" * 80)
    print("SPARK: Dashboard Query (Distributed Vectorized)")
    print("=" * 80)

    spark = get_spark_session()

    spark.read.parquet("data/sample_data/orders_base_50M.parquet").createOrReplaceTempView("orders")

    collector = SparkMetricsCollector(spark)
    timer = BenchmarkTimer()

    with collector.capture_metrics_safely():
        def run_query():
            return spark.sql(DASHBOARD_QUERY_SPARK).collect()

        cold_hot = timer.benchmark_cold_and_hot(run_query, "spark", clear_cache=False)
        io_metrics = timer.benchmark_with_io_breakdown(run_query, "spark")

    spill_metrics = collector.last_metrics
    spark.stop()

    result = {
        "system": "spark",
        "query": "dashboard_regional_revenue",
        **io_metrics,
        "cold_hot": cold_hot,
        "spill_metrics": spill_metrics,
        "demonstrates": "Catalyst optimizer + Tungsten execution — CMU 15-721 Lecture 07",
        "maps_to": "CMU 15-721 Lecture 07: Vectorized Execution",
    }

    print(f"   Time: {io_metrics['total_time_seconds']:.3f}s")
    print(f"   Cold/Hot: {cold_hot['cold']['time_seconds']:.3f}s / {cold_hot['hot']['time_seconds']:.3f}s (x{cold_hot['speedup']:.1f})")
    if spill_metrics.get("external_merge_occurred"):
        disk_mb = spill_metrics["disk_spill_bytes"] / (1024 ** 2)
        print(f"   SPILL: {disk_mb:.1f} MB to disk")

    return result


def run_all_systems():
    """Run dashboard benchmark on all local systems and save results."""

    print("\n" + "=" * 80)
    print(" USE CASE 1: SUB-SECOND DASHBOARD QUERIES")
    print(" Regional Revenue by Month (2023+)")
    print("=" * 80)
    print("\nQuery: GROUP BY region + month on 50M rows")
    print("Expected: Column stores (DuckDB) dramatically faster than row stores (Postgres)")
    print("=" * 80)

    all_results = {}

    try:
        postgres_result = benchmark_postgres()
        if postgres_result:
            all_results["postgres"] = postgres_result
    except Exception as e:
        print(f"Postgres benchmark failed: {e}")

    try:
        duckdb_result = benchmark_duckdb()
        all_results["duckdb"] = duckdb_result
    except Exception as e:
        print(f"DuckDB benchmark failed: {e}")

    try:
        spark_result = benchmark_spark()
        all_results["spark"] = spark_result
    except Exception as e:
        print(f"Spark benchmark failed: {e}")

    # Save results
    output_dir = Path("results")
    output_dir.mkdir(exist_ok=True)

    output_file = output_dir / "use_case_1_dashboards.json"
    with open(output_file, "w") as f:
        json.dump(all_results, f, indent=2)

    # Summary
    print("\n" + "=" * 80)
    print(" RESULTS SUMMARY: Dashboard Query")
    print("=" * 80)

    timings = {}
    for system, data in all_results.items():
        t = data["total_time_seconds"]
        timings[system] = t
        ch = data.get("cold_hot", {})
        speedup = ch.get("speedup", "N/A")
        print(f"\n{system.upper()}:")
        print(f"  Execution time:   {t:.3f}s")
        print(f"  Cold/Hot speedup: {speedup}x")
        print(f"  CPU/IO split:     {data.get('cpu_bound_percent', 0):.1f}% / {data.get('io_bound_percent', 0):.1f}%")
        print(f"  Demonstrates:     {data.get('demonstrates', 'N/A')}")

    if "postgres" in timings and "duckdb" in timings:
        speedup = timings["postgres"] / timings["duckdb"]
        print(f"\nDuckDB vs Postgres: {speedup:.1f}x faster")
        print("Proves: Vectorized column store beats tuple-at-a-time row store for analytics")

    print(f"\nFull results: {output_file}")

    # --- ConceptValidator: annotate results ---
    validator = ConceptValidator()

    # Buffer pool validation for each system
    for system, data in all_results.items():
        cold_hot = data.get("cold_hot", {})
        if cold_hot:
            cold_time = cold_hot.get("cold", {}).get("time_seconds", 1)
            hot_time = cold_hot.get("hot", {}).get("time_seconds", 1)
            validation = validator.validate_buffer_pool(cold_time, hot_time)
            all_results[system]["validation"] = validation
            validator.print_validation(validation)

    # Re-save with validation blocks
    with open(output_file, "w") as f:
        json.dump(all_results, f, indent=2)

    print(f"\nValidated results saved: {output_file}")
    return all_results


if __name__ == "__main__":
    run_all_systems()
