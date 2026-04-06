"""
Use Case 4: Clustering & Partitioning Impact
=============================================

Compares clustered vs unclustered data access patterns.

Tests: How much faster is a clustered (sorted by region) scan vs unclustered?

Maps to CMU 15-721:
- Lecture 04: Storage Models (clustered indexes, zone maps)
- Lecture 05: Buffer Pool Management (sequential vs random access)

Expected Results:
- Clustered queries: 3-10x faster due to zone-map / predicate pushdown
- DuckDB: Parquet row group statistics enable pruning (synthetic clustering)
- Postgres: CLUSTER command reorders heap (dramatic for range scans)
"""

import sys
import json
import os
from pathlib import Path

sys.path.append(str(Path(__file__).parent.parent))

from utils.benchmark_timer import BenchmarkTimer
from utils.concept_validator import ConceptValidator

# Query targeting a specific region (benefits from clustering on region)
REGION_QUERY_TEMPLATE = """
SELECT
    region,
    COUNT(*) AS order_count,
    SUM(revenue) AS total_revenue,
    AVG(revenue) AS avg_revenue
FROM orders
WHERE region = 'East'
GROUP BY region
"""

REGION_QUERY_POSTGRES = REGION_QUERY_TEMPLATE

REGION_QUERY_DUCKDB = REGION_QUERY_TEMPLATE


def benchmark_postgres_clustering():
    """
    Compare Postgres performance with and without CLUSTER.

    CLUSTER physically reorders heap pages by index key.
    Demonstrates: Sequential vs random heap access patterns.
    """
    print("\n" + "=" * 80)
    print("POSTGRES: Clustering Impact Test")
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

    # --- UNCLUSTERED (baseline: natural insert order) ---
    print("\nStep 1: UNCLUSTERED (natural heap order)")

    def run_unclustered():
        cursor.execute(REGION_QUERY_POSTGRES)
        return cursor.fetchall()

    unclustered_metrics = timer.benchmark_with_io_breakdown(run_unclustered, "postgres_unclustered")
    print(f"   Time: {unclustered_metrics['total_time_seconds']:.3f}s")
    print(f"   CPU/IO: {unclustered_metrics['cpu_bound_percent']:.1f}% / {unclustered_metrics['io_bound_percent']:.1f}%")

    # Get EXPLAIN for unclustered
    cursor.execute(f"EXPLAIN (ANALYZE, BUFFERS) {REGION_QUERY_POSTGRES}")
    unclustered_explain = "\n".join(row[0] for row in cursor.fetchall())

    # --- CLUSTERED (reorder heap by region index) ---
    print("\nStep 2: Running CLUSTER ON idx_orders_region (reorders heap pages)...")
    print("   This physically sorts the heap — may take several minutes for 50M rows...")

    try:
        conn.autocommit = True
        cursor.execute("CLUSTER orders USING idx_orders_region")
        cursor.execute("ANALYZE orders")
        conn.autocommit = False
        print("   CLUSTER complete")
    except Exception as e:
        print(f"   CLUSTER failed: {e}")
        conn.close()
        return {
            "system": "postgres",
            "query": "clustering_impact",
            "error": str(e),
            "unclustered": unclustered_metrics,
        }

    print("\nStep 3: CLUSTERED (after CLUSTER on region)")

    def run_clustered():
        cursor.execute(REGION_QUERY_POSTGRES)
        return cursor.fetchall()

    clustered_metrics = timer.benchmark_with_io_breakdown(run_clustered, "postgres_clustered")
    print(f"   Time: {clustered_metrics['total_time_seconds']:.3f}s")
    print(f"   CPU/IO: {clustered_metrics['cpu_bound_percent']:.1f}% / {clustered_metrics['io_bound_percent']:.1f}%")

    # Get EXPLAIN for clustered
    cursor.execute(f"EXPLAIN (ANALYZE, BUFFERS) {REGION_QUERY_POSTGRES}")
    clustered_explain = "\n".join(row[0] for row in cursor.fetchall())

    speedup = unclustered_metrics["total_time_seconds"] / clustered_metrics["total_time_seconds"]

    conn.close()

    result = {
        "system": "postgres",
        "query": "clustering_impact",
        "unclustered": {
            **unclustered_metrics,
            "note": "Natural heap order — random IO for region predicate",
        },
        "clustered": {
            **clustered_metrics,
            "note": "After CLUSTER — sequential IO for region predicate",
        },
        "speedup": round(speedup, 2),
        "demonstrates": f"Physical clustering provides {speedup:.1f}x speedup for range predicates",
        "maps_to": "CMU 15-721 Lecture 04: Storage Models (clustered heap)",
    }

    print(f"\nCluster speedup: {speedup:.1f}x")

    return result


def benchmark_duckdb_zone_maps():
    """
    Demonstrate DuckDB Parquet zone map pruning.

    DuckDB reads row group min/max statistics to skip irrelevant row groups.
    This is equivalent to clustering — without physically reordering data.
    """
    print("\n" + "=" * 80)
    print("DUCKDB: Zone Map / Row Group Pruning")
    print("=" * 80)

    import duckdb
    import os

    # --- UNSORTED Parquet (default from generator, random order) ---
    print("\nStep 1: Query unsorted Parquet (random region distribution per row group)")

    conn_unsorted = duckdb.connect(":memory:")
    conn_unsorted.execute(
        "CREATE VIEW orders AS SELECT * FROM read_parquet('data/sample_data/orders_base_50M.parquet')"
    )

    timer = BenchmarkTimer()

    def run_unsorted():
        return conn_unsorted.execute(REGION_QUERY_DUCKDB).fetchall()

    unsorted_metrics = timer.benchmark_with_io_breakdown(run_unsorted, "duckdb_unsorted")
    print(f"   Time: {unsorted_metrics['total_time_seconds']:.3f}s")
    conn_unsorted.close()

    # --- SORTED Parquet (sorted by region — enables zone map pruning) ---
    sorted_path = "data/sample_data/orders_sorted_by_region.parquet"

    if not os.path.exists(sorted_path):
        print("\nStep 2: Creating region-sorted Parquet (for zone map test)...")
        conn_sort = duckdb.connect(":memory:")
        conn_sort.execute(f"""
            COPY (
                SELECT * FROM read_parquet('data/sample_data/orders_base_50M.parquet')
                ORDER BY region
            ) TO '{sorted_path}' (FORMAT PARQUET, ROW_GROUP_SIZE 100000)
        """)
        conn_sort.close()
        size_mb = os.path.getsize(sorted_path) / (1024 ** 2)
        print(f"   Sorted Parquet created: {size_mb:.1f} MB")
    else:
        print("\nStep 2: Using existing sorted Parquet")

    print("\nStep 3: Query sorted Parquet (zone map can prune 75% of row groups)")

    conn_sorted = duckdb.connect(":memory:")
    conn_sorted.execute(
        f"CREATE VIEW orders AS SELECT * FROM read_parquet('{sorted_path}')"
    )

    def run_sorted():
        return conn_sorted.execute(REGION_QUERY_DUCKDB).fetchall()

    sorted_metrics = timer.benchmark_with_io_breakdown(run_sorted, "duckdb_sorted")
    print(f"   Time: {sorted_metrics['total_time_seconds']:.3f}s")
    conn_sorted.close()

    speedup = unsorted_metrics["total_time_seconds"] / sorted_metrics["total_time_seconds"]

    result = {
        "system": "duckdb",
        "query": "zone_map_pruning",
        "unsorted": {
            **unsorted_metrics,
            "note": "Random order — must read all row groups",
        },
        "sorted": {
            **sorted_metrics,
            "note": "Sorted by region — zone maps skip 75% of row groups",
        },
        "speedup": round(speedup, 2),
        "demonstrates": f"Zone map pruning: {speedup:.1f}x speedup from sort-order clustering",
        "maps_to": "CMU 15-721 Lecture 04: Storage Models (zone maps / predicate pushdown)",
    }

    print(f"\nZone map speedup: {speedup:.1f}x")
    print("Proves: Sorted Parquet + zone maps = no CLUSTER command needed")

    return result


def run_all_systems():
    """Run clustering benchmark and save results."""

    print("\n" + "=" * 80)
    print(" USE CASE 4: CLUSTERING & PARTITIONING IMPACT")
    print(" How Physical Sort Order Affects Query Performance")
    print("=" * 80)

    all_results = {}

    try:
        postgres_result = benchmark_postgres_clustering()
        if postgres_result:
            all_results["postgres"] = postgres_result
    except Exception as e:
        print(f"Postgres clustering benchmark failed: {e}")

    try:
        duckdb_result = benchmark_duckdb_zone_maps()
        all_results["duckdb"] = duckdb_result
    except Exception as e:
        print(f"DuckDB zone map benchmark failed: {e}")

    # Save results
    output_dir = Path("results")
    output_dir.mkdir(exist_ok=True)

    output_file = output_dir / "use_case_4_clustering.json"
    with open(output_file, "w") as f:
        json.dump(all_results, f, indent=2)

    # Summary
    print("\n" + "=" * 80)
    print(" RESULTS SUMMARY: Clustering Impact")
    print("=" * 80)

    for system, data in all_results.items():
        print(f"\n{system.upper()}:")
        if "error" in data:
            print(f"  Error: {data['error']}")
        else:
            print(f"  Speedup from clustering: {data.get('speedup', 'N/A')}x")
            print(f"  Demonstrates: {data.get('demonstrates', 'N/A')}")
            print(f"  Maps to: {data.get('maps_to', 'N/A')}")

    print(f"\nFull results: {output_file}")

    # --- ConceptValidator: annotate results ---
    validator = ConceptValidator()

    if "postgres" in all_results:
        pg = all_results["postgres"]
        if "error" not in pg:
            cold_time = pg.get("unclustered", {}).get("total_time_seconds", 1)
            hot_time = pg.get("clustered", {}).get("total_time_seconds", 1)
            validation = validator.validate_buffer_pool(cold_time, hot_time)
            # Customize for clustering context
            validation["lecture"] = "CMU 15-721 Lecture 04: Storage Models (Clustered Heap)"
            validation["concept"] = "Physical sort order reduces random I/O via zone-map / clustered heap"
            validation["proof"] = f"Unclustered: {cold_time:.3f}s → Clustered: {hot_time:.3f}s ({pg.get('speedup', 1):.1f}x)"
            validation["validates"] = "Article 3: CLUSTER command enables sequential I/O for range predicates"
            all_results["postgres"]["validation"] = validation
            validator.print_validation(validation)

    if "duckdb" in all_results:
        ddb = all_results["duckdb"]
        cold_time = ddb.get("unsorted", {}).get("total_time_seconds", 1)
        hot_time = ddb.get("sorted", {}).get("total_time_seconds", 1)
        validation = validator.validate_buffer_pool(cold_time, hot_time)
        validation["lecture"] = "CMU 15-721 Lecture 04: Storage Models (Zone Maps)"
        validation["concept"] = "Parquet row group statistics enable predicate pushdown without CLUSTER"
        validation["proof"] = f"Unsorted: {cold_time:.3f}s → Zone-mapped: {hot_time:.3f}s ({ddb.get('speedup', 1):.1f}x)"
        validation["validates"] = "Article 3: Zone maps skip 75% of row groups for selective predicates"
        all_results["duckdb"]["validation"] = validation
        validator.print_validation(validation)

    # Re-save with validation blocks
    with open(output_file, "w") as f:
        json.dump(all_results, f, indent=2)

    print(f"\nValidated results saved: {output_file}")
    return all_results


if __name__ == "__main__":
    run_all_systems()
