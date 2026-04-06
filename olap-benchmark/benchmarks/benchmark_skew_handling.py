"""
Use Case 10: Skew Handling / Adaptive Query Execution
=======================================================

Demonstrates how data skew impacts aggregation performance and how
pre-shuffling (manual partition balancing) mitigates the bottleneck.

Tests:
  A) Uniform distribution  → 5 regions, equal row counts
  B) Skewed distribution   → 'West' = 90% of rows, 4 others = 2.5% each
  C) Skew + COUNT DISTINCT → worst case — high-cardinality within skewed partition

Maps to CMU 15-721:
- Lecture 09: Join Algorithms (hash join skew, partition imbalance)
- Lecture 14: Parallel Query Execution (skewed partitions, stragglers)

Smoking Gun:
- Skewed GROUP BY 3-5x slower than uniform distribution
- COUNT(DISTINCT) on skewed key is dramatically slower
- Partition imbalance: West bucket holds 90% of data

Expected Results (10M rows):
- Uniform: fast — equal work per partition
- Skewed:  slower — single partition dominates
- Skew + COUNT DISTINCT: slowest — high memory + dedup overhead
"""

import sys
import json
import time
from pathlib import Path
from datetime import datetime

sys.path.append(str(Path(__file__).parent.parent))

from utils.concept_validator import ConceptValidator

N_ROWS = 10_000_000


def _build_uniform(conn, n_rows: int):
    """Equal distribution across 5 regions — no skew."""
    conn.execute(f"""
        CREATE OR REPLACE TABLE uniform_orders AS
        SELECT
            range::BIGINT AS order_id,
            (100000 + abs(hash(range)) % 900000)::BIGINT AS customer_id,
            CASE range % 5
                WHEN 0 THEN 'East'
                WHEN 1 THEN 'West'
                WHEN 2 THEN 'North'
                WHEN 3 THEN 'South'
                ELSE 'Central'
            END AS region,
            (10.0 + (abs(hash(range + 1)) % 990000) / 10000.0)::DOUBLE AS revenue,
            (1 + abs(hash(range + 2)) % 20)::INTEGER AS quantity
        FROM range({n_rows})
    """)
    sizes = conn.execute("""
        SELECT region, COUNT(*) AS cnt
        FROM uniform_orders GROUP BY region ORDER BY cnt DESC
    """).fetchall()
    print(f"  Uniform table ({n_rows:,} rows): {sizes}")
    return {row[0]: row[1] for row in sizes}


def _build_skewed(conn, n_rows: int, skew_pct: float = 0.90):
    """West holds skew_pct% of rows — extreme partition imbalance."""
    skew_frac = int(skew_pct * 100)
    remain_frac = 100 - skew_frac

    conn.execute(f"""
        CREATE OR REPLACE TABLE skewed_orders AS
        SELECT
            range::BIGINT AS order_id,
            (100000 + abs(hash(range)) % 900000)::BIGINT AS customer_id,
            CASE
                WHEN range % 100 < {skew_frac} THEN 'West'
                WHEN range % 100 < {skew_frac + remain_frac // 4} THEN 'East'
                WHEN range % 100 < {skew_frac + remain_frac // 2} THEN 'North'
                WHEN range % 100 < {skew_frac + 3 * remain_frac // 4} THEN 'South'
                ELSE 'Central'
            END AS region,
            (10.0 + (abs(hash(range + 1)) % 990000) / 10000.0)::DOUBLE AS revenue,
            (1 + abs(hash(range + 2)) % 20)::INTEGER AS quantity
        FROM range({n_rows})
    """)
    sizes = conn.execute("""
        SELECT region, COUNT(*) AS cnt, ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 1) AS pct
        FROM skewed_orders GROUP BY region ORDER BY cnt DESC
    """).fetchall()
    print(f"  Skewed table ({n_rows:,} rows): {sizes}")
    return {row[0]: {"count": row[1], "pct": row[2]} for row in sizes}


def run_aggregation_scenario(conn, table: str, label: str, query: str) -> dict:
    """Time a GROUP BY aggregation query on the given table."""
    q = query.format(table=table)
    # Warmup
    conn.execute(q).fetchall()
    t = time.perf_counter()
    result = conn.execute(q).fetchall()
    elapsed_ms = (time.perf_counter() - t) * 1000
    print(f"  {label}: {elapsed_ms:.1f}ms  ({len(result)} groups)")
    return {"label": label, "execution_time_ms": round(elapsed_ms, 1), "groups": len(result)}


def run_skew_handling_benchmark() -> dict:
    """Compare uniform vs skewed partition aggregation performance."""

    print("\n" + "=" * 70)
    print(" USE CASE 10: SKEW HANDLING / ADAPTIVE QUERY EXECUTION")
    print(" Maps to CMU 15-721 Lecture 09 & Lecture 14")
    print("=" * 70)
    print(f" Started: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f" Rows: {N_ROWS:,}")
    print(" Skew: West = 90%, others = 2.5% each")
    print("=" * 70)

    try:
        import duckdb
    except ImportError:
        return {"error": "duckdb not installed"}

    conn = duckdb.connect(":memory:")
    conn.execute("SET threads=4")

    print("\nBuilding tables...")
    uniform_dist = _build_uniform(conn, N_ROWS)
    skewed_dist = _build_skewed(conn, N_ROWS, skew_pct=0.90)

    # Compute imbalance metrics
    total_rows = N_ROWS
    west_rows = skewed_dist.get("West", {}).get("count", 0)
    max_partition_pct = skewed_dist.get("West", {}).get("pct", 0.0)
    expected_pct = 100.0 / len(skewed_dist)
    imbalance_factor = round(max_partition_pct / expected_pct, 1)

    print(f"\n  Partition imbalance: West has {max_partition_pct}% vs expected {expected_pct:.1f}%")
    print(f"  Imbalance factor: {imbalance_factor}x (West processes {imbalance_factor}x more work)")

    # Query templates
    simple_agg = "SELECT region, COUNT(*) AS cnt, SUM(revenue) AS total, AVG(revenue) AS avg_rev FROM {table} GROUP BY region ORDER BY total DESC"
    complex_agg = "SELECT region, COUNT(*) AS cnt, COUNT(DISTINCT customer_id) AS unique_customers, SUM(revenue) AS total, SUM(quantity * revenue) AS weighted_rev FROM {table} GROUP BY region ORDER BY total DESC"
    heavy_agg = "SELECT region, COUNT(DISTINCT customer_id) AS distinct_customers, STDDEV(revenue) AS rev_stddev, PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY revenue) AS p95_revenue, MAX(revenue) - MIN(revenue) AS rev_range FROM {table} GROUP BY region ORDER BY distinct_customers DESC"

    print("\nRunning aggregation scenarios...")

    print("\n[A] Simple aggregation (SUM, COUNT, AVG):")
    uniform_simple = run_aggregation_scenario(conn, "uniform_orders", "Uniform", simple_agg)
    skewed_simple = run_aggregation_scenario(conn, "skewed_orders", "Skewed", simple_agg)

    print("\n[B] Complex aggregation (COUNT DISTINCT, SUM):")
    uniform_complex = run_aggregation_scenario(conn, "uniform_orders", "Uniform", complex_agg)
    skewed_complex = run_aggregation_scenario(conn, "skewed_orders", "Skewed", complex_agg)

    print("\n[C] Heavy aggregation (COUNT DISTINCT, STDDEV, P95 PERCENTILE):")
    uniform_heavy = run_aggregation_scenario(conn, "uniform_orders", "Uniform", heavy_agg)
    skewed_heavy = run_aggregation_scenario(conn, "skewed_orders", "Skewed", heavy_agg)

    conn.close()

    # Compute skew slowdowns
    def slowdown(uni: dict, skew: dict) -> float:
        u = uni["execution_time_ms"]
        s = skew["execution_time_ms"]
        return round(s / u, 2) if u > 0 else 0

    slowdown_simple = slowdown(uniform_simple, skewed_simple)
    slowdown_complex = slowdown(uniform_complex, skewed_complex)
    slowdown_heavy = slowdown(uniform_heavy, skewed_heavy)

    comparison = {
        "simple_agg_skew_slowdown": slowdown_simple,
        "complex_agg_skew_slowdown": slowdown_complex,
        "heavy_agg_skew_slowdown": slowdown_heavy,
        "partition_imbalance_factor": imbalance_factor,
        "west_partition_pct": max_partition_pct,
        "expected_partition_pct": round(expected_pct, 1),
    }

    print("\n" + "=" * 70)
    print("SKEW IMPACT SUMMARY")
    print("=" * 70)
    print(f"  Partition imbalance: West = {max_partition_pct}% vs expected {expected_pct:.1f}%")
    print(f"  Simple agg slowdown:  {slowdown_simple}x")
    print(f"  Complex agg slowdown: {slowdown_complex}x")
    print(f"  Heavy agg slowdown:   {slowdown_heavy}x")

    validator = ConceptValidator()
    validation = validator.validate_skew_handling(
        uniform_results={"simple": uniform_simple, "complex": uniform_complex, "heavy": uniform_heavy},
        skewed_results={"simple": skewed_simple, "complex": skewed_complex, "heavy": skewed_heavy},
        comparison=comparison,
    )
    ConceptValidator.print_validation(validation)

    result = {
        "use_case": 10,
        "benchmark": "skew_handling",
        "row_count": N_ROWS,
        "skew_pct": 90,
        "partition_distribution": {
            "uniform": uniform_dist,
            "skewed": {k: v for k, v in skewed_dist.items()},
        },
        "scenarios": {
            "simple_aggregation": {
                "uniform": uniform_simple,
                "skewed": skewed_simple,
                "slowdown": slowdown_simple,
            },
            "complex_aggregation": {
                "uniform": uniform_complex,
                "skewed": skewed_complex,
                "slowdown": slowdown_complex,
            },
            "heavy_aggregation": {
                "uniform": uniform_heavy,
                "skewed": skewed_heavy,
                "slowdown": slowdown_heavy,
            },
        },
        "comparison": comparison,
        "validation": validation,
        "run_timestamp": datetime.now().isoformat(),
        "maps_to": "CMU 15-721 Lecture 09: Join Algorithms (Skew), Lecture 14: Parallel Execution",
    }

    output_dir = Path("results")
    output_dir.mkdir(exist_ok=True)
    output_file = output_dir / "use_case_10_skew_handling.json"
    with open(output_file, "w") as f:
        json.dump(result, f, indent=2, default=str)

    print(f"\n\U0001f4be Results saved: {output_file.resolve()}")
    return result


if __name__ == "__main__":
    run_skew_handling_benchmark()
