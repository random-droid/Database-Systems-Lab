"""
Use Case 8: Window Functions / Analytical Patterns
====================================================

Compares window function execution across DuckDB (vectorized) vs Python pandas
vs Postgres (if available) on a realistic revenue-analysis workload.

Tests: How much faster is DuckDB's vectorized window execution vs pandas groupby?

Maps to CMU 15-721:
- Lecture 11: Advanced Operators (window functions, sorted aggregation)
- Lecture 10: Vectorized Execution (operator pipelining)

Window operators tested:
- LAG / LEAD      (partition-ordered access to adjacent rows)
- ROW_NUMBER      (dense ranking within partition)
- SUM / AVG OVER  (running partition aggregate)
- RANK            (tied-rank assignment)

Expected Results:
- DuckDB: Fastest (vectorized window sort + bounded hash agg)
- Pandas: 1.5-4x slower (Python interpreter overhead + extra sort pass)
- Postgres: Slowest (tuple-at-a-time iterator model)
"""

import sys
import json
import time
from pathlib import Path
from datetime import datetime

sys.path.append(str(Path(__file__).parent.parent))

from utils.concept_validator import ConceptValidator

N_ROWS = 2_000_000   # 2M rows (window sort is memory-intensive; 5M times out)

WINDOW_QUERY = """
SELECT
    order_id,
    customer_id,
    region,
    revenue,
    order_date,
    LAG(revenue, 1) OVER (PARTITION BY region ORDER BY order_id)       AS prev_revenue,
    LEAD(revenue, 1) OVER (PARTITION BY region ORDER BY order_id)      AS next_revenue,
    ROW_NUMBER() OVER (PARTITION BY region ORDER BY revenue DESC)       AS revenue_rank,
    RANK() OVER (PARTITION BY region ORDER BY revenue DESC)             AS revenue_rank_tied,
    SUM(revenue) OVER (PARTITION BY region)                            AS region_total_revenue,
    AVG(revenue) OVER (PARTITION BY region)                            AS region_avg_revenue,
    revenue - AVG(revenue) OVER (PARTITION BY region)                  AS revenue_vs_avg
FROM orders
"""

WINDOW_QUERY_POSTGRES = """
SELECT
    order_id,
    customer_id,
    region,
    revenue,
    order_date,
    LAG(revenue, 1) OVER (PARTITION BY region ORDER BY order_id)       AS prev_revenue,
    LEAD(revenue, 1) OVER (PARTITION BY region ORDER BY order_id)      AS next_revenue,
    ROW_NUMBER() OVER (PARTITION BY region ORDER BY revenue DESC)       AS revenue_rank,
    RANK() OVER (PARTITION BY region ORDER BY revenue DESC)             AS revenue_rank_tied,
    SUM(revenue) OVER (PARTITION BY region)                            AS region_total_revenue,
    AVG(revenue) OVER (PARTITION BY region)                            AS region_avg_revenue,
    revenue - AVG(revenue) OVER (PARTITION BY region)                  AS revenue_vs_avg
FROM orders_window
"""


def _generate_data(conn, n_rows: int):
    """Generate synthetic data in DuckDB."""
    conn.execute(f"""
        CREATE OR REPLACE TABLE orders AS
        SELECT
            range::BIGINT AS order_id,
            (100000 + abs(hash(range)) % 900000) AS customer_id,
            CASE abs(hash(range + 1)) % 5
                WHEN 0 THEN 'East'
                WHEN 1 THEN 'West'
                WHEN 2 THEN 'North'
                WHEN 3 THEN 'South'
                ELSE 'Central'
            END AS region,
            (10.0 + (abs(hash(range + 2)) % 990000) / 10000.0)::DOUBLE AS revenue,
            ('2023-01-01'::DATE + ((abs(hash(range + 3)) % 730)::INTEGER)) AS order_date
        FROM range({n_rows})
    """)
    print(f"  Generated {n_rows:,} rows in DuckDB")


def benchmark_duckdb_window(n_rows: int) -> dict:
    """DuckDB: vectorized window operators."""
    print("\n" + "=" * 70)
    print("SYSTEM: DuckDB — Vectorized Window Operators")
    print("=" * 70)

    import duckdb

    conn = duckdb.connect(":memory:")
    _generate_data(conn, n_rows)

    # Warmup
    conn.execute(WINDOW_QUERY + " LIMIT 1000").fetchall()

    t_start = time.perf_counter()
    result = conn.execute(WINDOW_QUERY).fetchall()
    elapsed_ms = (time.perf_counter() - t_start) * 1000

    rows_per_second = n_rows / (elapsed_ms / 1000) if elapsed_ms > 0 else 0
    print(f"  Rows: {n_rows:,}")
    print(f"  Execution time: {elapsed_ms:.1f}ms")
    print(f"  Throughput: {rows_per_second:,.0f} rows/sec")
    print(f"  Output rows: {len(result):,}")
    print(f"  Window ops: LAG, LEAD, ROW_NUMBER, RANK, SUM OVER, AVG OVER, delta")

    conn.close()
    return {
        "available": True,
        "execution_time_ms": round(elapsed_ms, 1),
        "rows_processed": n_rows,
        "rows_per_second": round(rows_per_second),
        "window_ops": ["LAG", "LEAD", "ROW_NUMBER", "RANK", "SUM OVER", "AVG OVER", "delta"],
        "execution_model": "vectorized (bounded hash agg + sorted partition)",
    }


def benchmark_pandas_window(n_rows: int) -> dict:
    """Python pandas: groupby-based window simulation."""
    print("\n" + "=" * 70)
    print("SYSTEM: Pandas — GroupBy-based Window Simulation")
    print("=" * 70)

    try:
        import pandas as pd
        import duckdb
        import numpy as np

        # Fetch data from DuckDB into a DataFrame
        conn = duckdb.connect(":memory:")
        _generate_data(conn, n_rows)
        t_fetch = time.perf_counter()
        df = conn.execute(
            "SELECT order_id, customer_id, region, revenue, order_date FROM orders"
        ).df()
        conn.close()
        fetch_ms = (time.perf_counter() - t_fetch) * 1000
        print(f"  Data fetch time: {fetch_ms:.0f}ms (not counted in window time)")

        # Timed window computation
        t_start = time.perf_counter()

        df_sorted = df.sort_values(["region", "order_id"]).copy()

        # LAG / LEAD
        df_sorted["prev_revenue"] = df_sorted.groupby("region")["revenue"].shift(1)
        df_sorted["next_revenue"] = df_sorted.groupby("region")["revenue"].shift(-1)

        # ROW_NUMBER and RANK (sort by revenue DESC within region)
        df_sorted["revenue_rank"] = (
            df_sorted.sort_values("revenue", ascending=False)
            .groupby("region")
            .cumcount() + 1
        )
        df_sorted["revenue_rank_tied"] = df_sorted.groupby("region")["revenue"].rank(
            ascending=False, method="min"
        ).astype(int)

        # SUM and AVG OVER partition
        region_agg = df_sorted.groupby("region")["revenue"].agg(["sum", "mean"]).reset_index()
        region_agg.columns = ["region", "region_total_revenue", "region_avg_revenue"]
        df_sorted = df_sorted.merge(region_agg, on="region", how="left")
        df_sorted["revenue_vs_avg"] = df_sorted["revenue"] - df_sorted["region_avg_revenue"]

        elapsed_ms = (time.perf_counter() - t_start) * 1000
        rows_per_second = n_rows / (elapsed_ms / 1000) if elapsed_ms > 0 else 0

        print(f"  Rows: {n_rows:,}")
        print(f"  Execution time: {elapsed_ms:.1f}ms")
        print(f"  Throughput: {rows_per_second:,.0f} rows/sec")
        print(f"  Note: Requires extra sort pass + merge — not operator-fused like DuckDB")

        return {
            "available": True,
            "execution_time_ms": round(elapsed_ms, 1),
            "rows_processed": n_rows,
            "rows_per_second": round(rows_per_second),
            "window_ops": ["shift (LAG/LEAD)", "cumcount (ROW_NUMBER)", "rank", "groupby agg + merge"],
            "execution_model": "pandas groupby (extra sort + merge, no operator fusion)",
            "note": "pandas requires a separate sort pass and merge join — no window pipelining",
        }

    except ImportError as e:
        print(f"  Pandas not available: {e}")
        return {"available": False, "note": f"pandas not installed: {e}"}
    except Exception as e:
        print(f"  Error: {e}")
        return {"available": False, "error": str(e)[:200]}


def benchmark_postgres_window(n_rows: int) -> dict:
    """Postgres: row-at-a-time window execution (real RDBMS)."""
    print("\n" + "=" * 70)
    print("SYSTEM: Postgres — Row-at-a-time Window Execution")
    print("=" * 70)

    sample = min(n_rows, 300_000)  # Postgres: load a sample

    try:
        import psycopg2
        import io
        import duckdb

        conn_pg = psycopg2.connect(
            host=__import__("os").environ.get("POSTGRES_HOST", "localhost"),
            port=int(__import__("os").environ.get("POSTGRES_PORT", "5432")),
            dbname=__import__("os").environ.get("POSTGRES_DB", "benchmark"),
            user=__import__("os").environ.get("POSTGRES_USER", "postgres"),
            password=__import__("os").environ.get("POSTGRES_PASSWORD", ""),
            connect_timeout=5,
        )
        cursor = conn_pg.cursor()
        cursor.execute("DROP TABLE IF EXISTS orders_window")
        cursor.execute("""
            CREATE TEMP TABLE orders_window (
                order_id BIGINT, customer_id BIGINT,
                region TEXT, revenue DOUBLE PRECISION, order_date DATE
            )
        """)

        # Generate data and COPY to Postgres
        conn_duck = duckdb.connect(":memory:")
        _generate_data(conn_duck, sample)
        rows = conn_duck.execute(
            "SELECT order_id, customer_id, region, revenue, order_date FROM orders LIMIT ?",
            [sample],
        ).fetchall()
        conn_duck.close()

        buf = io.StringIO()
        for row in rows:
            buf.write(f"{row[0]}\t{row[1]}\t{row[2]}\t{row[3]}\t{row[4]}\n")
        buf.seek(0)
        cursor.copy_from(buf, "orders_window", columns=["order_id", "customer_id", "region", "revenue", "order_date"])
        conn_pg.commit()

        # Warmup
        cursor.execute(WINDOW_QUERY_POSTGRES + " LIMIT 100")
        cursor.fetchall()

        t_start = time.perf_counter()
        cursor.execute(WINDOW_QUERY_POSTGRES)
        cursor.fetchall()
        elapsed_ms = (time.perf_counter() - t_start) * 1000

        rows_per_second = sample / (elapsed_ms / 1000) if elapsed_ms > 0 else 0
        scale = n_rows / sample
        extrapolated_ms = elapsed_ms * scale

        print(f"  Rows (sample): {sample:,}")
        print(f"  Execution time: {elapsed_ms:.1f}ms sample, {extrapolated_ms:.0f}ms extrap.")
        print(f"  Throughput: {rows_per_second:,.0f} rows/sec")

        cursor.close()
        conn_pg.close()

        return {
            "available": True,
            "execution_time_ms": round(extrapolated_ms, 1),
            "execution_time_ms_sample": round(elapsed_ms, 1),
            "rows_processed": n_rows,
            "rows_sampled": sample,
            "rows_per_second": round(rows_per_second),
            "execution_model": "row-at-a-time (Volcano window sort)",
            "note": f"Measured on {sample:,} rows, extrapolated ×{scale:.0f}",
        }

    except Exception as e:
        print(f"  Postgres not available: {type(e).__name__}: {str(e)[:80]}")
        return {"available": False, "note": f"Postgres unavailable: {type(e).__name__}"}


def run_window_functions_benchmark() -> dict:
    """Run all window function benchmarks."""

    print("\n" + "=" * 70)
    print(" USE CASE 8: WINDOW FUNCTIONS / ANALYTICAL PATTERNS")
    print(" Maps to CMU 15-721 Lecture 11 (Advanced Operators)")
    print("=" * 70)
    print(f" Started: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f" Rows: {N_ROWS:,}")
    print(" Ops: LAG, LEAD, ROW_NUMBER, RANK, SUM OVER, AVG OVER, delta")
    print("=" * 70)

    duckdb_result = benchmark_duckdb_window(N_ROWS)
    pandas_result = benchmark_pandas_window(N_ROWS)
    postgres_result = benchmark_postgres_window(N_ROWS)

    # Speedups
    speedup = {}
    duck_ms = duckdb_result.get("execution_time_ms", 0) if duckdb_result.get("available") else 0
    pandas_ms = pandas_result.get("execution_time_ms", 0) if pandas_result.get("available") else 0
    pg_ms = postgres_result.get("execution_time_ms", 0) if postgres_result.get("available") else 0

    if duck_ms > 0:
        if pandas_ms > 0:
            speedup["duckdb_vs_pandas"] = round(pandas_ms / duck_ms, 1)
        if pg_ms > 0:
            speedup["duckdb_vs_postgres"] = round(pg_ms / duck_ms, 1)

    validator = ConceptValidator()
    validation = validator.validate_window_functions(
        duckdb_result=duckdb_result,
        pandas_result=pandas_result,
        postgres_result=postgres_result,
        speedup=speedup,
    )
    ConceptValidator.print_validation(validation)

    result = {
        "use_case": 8,
        "benchmark": "window_functions",
        "row_count": N_ROWS,
        "query": "LAG, LEAD, ROW_NUMBER, RANK, SUM OVER, AVG OVER partitioned by region",
        "systems": {
            "duckdb": duckdb_result,
            "pandas": pandas_result,
            "postgres": postgres_result,
        },
        "speedup": speedup,
        "validation": validation,
        "run_timestamp": datetime.now().isoformat(),
        "maps_to": "CMU 15-721 Lecture 11: Advanced Operators (window functions)",
    }

    output_dir = Path("results")
    output_dir.mkdir(exist_ok=True)
    output_file = output_dir / "use_case_8_window_functions.json"
    with open(output_file, "w") as f:
        json.dump(result, f, indent=2, default=str)

    print(f"\n\U0001f4be Results saved: {output_file.resolve()}")
    return result


if __name__ == "__main__":
    run_window_functions_benchmark()
