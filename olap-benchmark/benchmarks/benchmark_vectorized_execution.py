"""
Use Case 6: Vectorized Execution & SIMD
=========================================

Compares vectorized execution (DuckDB) vs columnar NumPy vs row-at-a-time
Python scalar loop on a compute-intensive arithmetic aggregation.

Tests: How much faster is vectorized execution (1024-tuple SIMD batches)
       compared to row-at-a-time Volcano-model processing?

Maps to CMU 15-721:
- Lecture 10: Vectorized Execution (SIMD, vector-at-a-time)
- Lecture 11: Vectorized Operators (aggregation, hash join)
- Lecture 12: Query Compilation (LLVM, code generation)

Expected Results:
- DuckDB: Fastest — true vectorized execution (1024-tuple SIMD vectors)
- NumPy: 2-5x slower than DuckDB — columnar BLAS/SIMD but no query pushdown
- Python scalar: 50-200x slower than DuckDB — row-at-a-time Volcano model
"""

import sys
import json
import time
import tempfile
import shutil
from pathlib import Path
from datetime import datetime

sys.path.append(str(Path(__file__).parent.parent))

from utils.concept_validator import ConceptValidator
from utils.benchmark_timer import inject_peak_memory, PeakMemoryCapture

# Row counts
N_ROWS_FULL = 10_000_000   # DuckDB and NumPy (fast, vectorized)
N_ROWS_SCALAR = 500_000    # Python scalar (extrapolated to full scale)

# Heavy arithmetic query — 6 arithmetic operations per row, 2 CASE expressions
VECTORIZED_QUERY = """
SELECT
    category,
    region,
    COUNT(*) AS order_count,
    SUM(price * quantity) AS gross_revenue,
    SUM(price * quantity * (1.0 - discount)) AS net_revenue,
    SUM(price * quantity * (1.0 - discount) * (1.0 - tax_rate)) AS after_tax_revenue,
    AVG(price) AS avg_price,
    STDDEV(price) AS price_stddev,
    MIN(price) AS min_price,
    MAX(price) AS max_price,
    SUM(CASE WHEN quantity > 5 THEN price * quantity ELSE 0 END) AS bulk_revenue,
    SUM(CASE WHEN discount > 0.1 THEN price * quantity * discount ELSE 0 END) AS discount_value
FROM orders
GROUP BY category, region
ORDER BY after_tax_revenue DESC
"""


def _generate_duckdb_data(conn, n_rows: int):
    """
    Generate synthetic e-commerce data using DuckDB's built-in functions.
    No external Parquet files required — hash() creates deterministic values.
    """
    conn.execute(f"""
        CREATE OR REPLACE TABLE orders AS
        SELECT
            range::BIGINT AS order_id,
            CASE abs(hash(range)) % 8
                WHEN 0 THEN 'Electronics'
                WHEN 1 THEN 'Clothing'
                WHEN 2 THEN 'Books'
                WHEN 3 THEN 'Food'
                WHEN 4 THEN 'Sports'
                WHEN 5 THEN 'Home'
                WHEN 6 THEN 'Auto'
                ELSE 'Health'
            END AS category,
            CASE abs(hash(range + 1)) % 5
                WHEN 0 THEN 'East'
                WHEN 1 THEN 'West'
                WHEN 2 THEN 'North'
                WHEN 3 THEN 'South'
                ELSE 'Central'
            END AS region,
            10.0 + (abs(hash(range + 2)) % 990000) / 10000.0 AS price,
            (1 + abs(hash(range + 3)) % 20)::INTEGER AS quantity,
            (abs(hash(range + 4)) % 41) / 100.0 AS discount,
            (abs(hash(range + 5)) % 35) / 100.0 AS tax_rate
        FROM range({n_rows})
    """)
    print(f"  Generated {n_rows:,} rows in DuckDB")


def benchmark_duckdb_vectorized(n_rows: int) -> dict:
    """
    DuckDB: true vectorized execution (1024-tuple SIMD batches).

    DuckDB's execution engine processes data in fixed-size vectors (1024 tuples
    by default). SIMD instructions operate on an entire vector in one CPU instruction.
    This is the execution model described in CMU 15-721 Lecture 10.
    """
    print("\n" + "=" * 70)
    print("SYSTEM: DuckDB — Vectorized Execution (1024-tuple SIMD batches)")
    print("=" * 70)

    import duckdb

    conn = duckdb.connect(":memory:")
    conn.execute("SET threads=4")

    try:
        # Generate data
        t_gen_start = time.perf_counter()
        _generate_duckdb_data(conn, n_rows)
        gen_time = time.perf_counter() - t_gen_start
        print(f"  Data generation: {gen_time:.2f}s")

        # Warmup (1 run to compile and fill caches)
        conn.execute(VECTORIZED_QUERY).fetchall()

        # Timed run
        t_start = time.perf_counter()
        result = conn.execute(VECTORIZED_QUERY).fetchall()
        elapsed_s = time.perf_counter() - t_start
        elapsed_ms = elapsed_s * 1000

        rows_per_second = n_rows / elapsed_s
        print(f"  Rows processed: {n_rows:,}")
        print(f"  Execution time: {elapsed_ms:.1f}ms")
        print(f"  Throughput:     {rows_per_second:,.0f} rows/sec")
        print(f"  Result groups:  {len(result)} category×region combinations")
        print(f"  Batch model:    vectorized (1024-tuple SIMD vectors)")

        return {
            "available": True,
            "execution_time_ms": round(elapsed_ms, 2),
            "rows_processed": n_rows,
            "rows_per_second": round(rows_per_second),
            "batch_model": "vectorized (1024-tuple SIMD batches)",
            "vector_size": 1024,
            "simd_capable": True,
            "result_groups": len(result),
            "query_operators": "Vectorized HashAgg + Vectorized Arithmetic + SIMD CASE",
        }
    except Exception as e:
        print(f"  ERROR: {e}")
        return {"available": False, "error": str(e)[:200]}
    finally:
        conn.close()


def benchmark_numpy_vectorized(n_rows: int) -> dict:
    """
    NumPy: columnar SIMD operations (full-column vectorization).

    NumPy applies arithmetic to entire columns at once using BLAS/SIMD.
    Unlike DuckDB, it has no query optimization (no predicate pushdown, no
    short-circuit evaluation), but it does leverage SIMD registers.
    This represents a 'columnar but unoptimized' execution model.
    """
    print("\n" + "=" * 70)
    print("SYSTEM: NumPy — Columnar Vectorized (full-column SIMD, no query opt)")
    print("=" * 70)

    try:
        import numpy as np
        import duckdb

        # Use DuckDB to fetch the data arrays (simulates reading columnar storage)
        conn = duckdb.connect(":memory:")
        _generate_duckdb_data(conn, n_rows)

        t_fetch = time.perf_counter()
        result = conn.execute(
            "SELECT price, quantity, discount, tax_rate FROM orders"
        ).fetchnumpy()
        fetch_time = time.perf_counter() - t_fetch
        print(f"  Column fetch time: {fetch_time:.2f}s")

        prices = result["price"].astype(np.float64)
        quantities = result["quantity"].astype(np.float64)
        discounts = result["discount"].astype(np.float64)
        tax_rates = result["tax_rate"].astype(np.float64)
        conn.close()

        # Warmup
        _ = (prices * quantities * (1.0 - discounts) * (1.0 - tax_rates)).sum()

        # Timed run — same arithmetic as DuckDB query
        t_start = time.perf_counter()
        gross = (prices * quantities).sum()
        net = (prices * quantities * (1.0 - discounts)).sum()
        after_tax = (prices * quantities * (1.0 - discounts) * (1.0 - tax_rates)).sum()
        bulk = (prices * quantities * (quantities > 5)).sum()
        discount_val = (prices * quantities * discounts * (discounts > 0.1)).sum()
        avg_price = prices.mean()
        std_price = prices.std()
        elapsed_s = time.perf_counter() - t_start
        elapsed_ms = elapsed_s * 1000

        rows_per_second = n_rows / elapsed_s
        print(f"  Rows processed: {n_rows:,}")
        print(f"  Execution time: {elapsed_ms:.1f}ms")
        print(f"  Throughput:     {rows_per_second:,.0f} rows/sec")
        print(f"  Note: gross={gross:,.0f}, net={net:,.0f}, after_tax={after_tax:,.0f}")
        print(f"  Batch model:    columnar (full-column NumPy SIMD, no GROUP BY)")

        return {
            "available": True,
            "execution_time_ms": round(elapsed_ms, 2),
            "rows_processed": n_rows,
            "rows_per_second": round(rows_per_second),
            "batch_model": "columnar (full-column NumPy SIMD, no query optimization)",
            "vector_size": n_rows,
            "simd_capable": True,
            "note": "No GROUP BY or query optimization — pure arithmetic kernel comparison",
        }
    except Exception as e:
        print(f"  ERROR: {e}")
        return {"available": False, "error": str(e)[:200]}


def benchmark_python_scalar(n_rows_sample: int, n_rows_full: int) -> dict:
    """
    Python scalar: row-at-a-time loop — the Volcano iterator model.

    This simulates what a naive Volcano-model executor does: for each row,
    fetch values, evaluate each expression, accumulate. No SIMD, no batching.
    CMU 15-721 Lecture 10 explains why this is 10-100x slower than vectorized.

    We sample n_rows_sample rows and extrapolate to n_rows_full.
    """
    print("\n" + "=" * 70)
    print("SYSTEM: Python Scalar — Row-at-a-time (Volcano iterator model)")
    print("=" * 70)

    try:
        import duckdb

        conn = duckdb.connect(":memory:")
        _generate_duckdb_data(conn, n_rows_sample)

        result = conn.execute(
            "SELECT price, quantity, discount, tax_rate, category, region FROM orders LIMIT ?",
            [n_rows_sample],
        ).fetchall()
        conn.close()

        print(f"  Fetched {len(result):,} rows for scalar measurement")

        # Row-at-a-time loop — pure Python, no numpy, no SIMD
        # Also simulates GROUP BY (dict accumulation), matching DuckDB query cost
        t_start = time.perf_counter()
        groups: dict = {}
        for row in result:
            price, qty, disc, tax, cat, reg = (
                row[0], row[1], row[2], row[3], row[4], row[5]
            )
            key = (cat, reg)
            if key not in groups:
                groups[key] = {
                    "count": 0, "net": 0.0, "after_tax": 0.0,
                    "gross": 0.0, "bulk": 0.0, "disc_val": 0.0,
                    "min_price": price, "max_price": price, "prices": [],
                }
            g = groups[key]
            gross = price * qty
            net = gross * (1.0 - disc)
            after_tax = net * (1.0 - tax)
            g["count"] += 1
            g["gross"] += gross
            g["net"] += net
            g["after_tax"] += after_tax
            if qty > 5:
                g["bulk"] += gross
            if disc > 0.1:
                g["disc_val"] += gross * disc
            if price < g["min_price"]:
                g["min_price"] = price
            if price > g["max_price"]:
                g["max_price"] = price
            g["prices"].append(price)
        elapsed_s = time.perf_counter() - t_start
        elapsed_ms = elapsed_s * 1000

        # Extrapolate to full dataset
        scale_factor = n_rows_full / n_rows_sample
        extrapolated_ms = elapsed_ms * scale_factor
        rows_per_second = n_rows_sample / elapsed_s

        print(f"  Rows sampled:       {n_rows_sample:,}")
        print(f"  Sample time:        {elapsed_ms:.1f}ms")
        print(f"  Throughput:         {rows_per_second:,.0f} rows/sec")
        print(f"  Extrapolated ({n_rows_full:,} rows): {extrapolated_ms / 1000:.1f}s")
        print(f"  Batch model:        row-at-a-time (Volcano iterator model)")

        return {
            "available": True,
            "execution_time_ms": round(extrapolated_ms, 2),
            "execution_time_ms_sample": round(elapsed_ms, 2),
            "rows_processed": n_rows_full,
            "rows_sampled": n_rows_sample,
            "rows_per_second": round(rows_per_second),
            "batch_model": "row-at-a-time (Volcano iterator model — Python for loop)",
            "vector_size": 1,
            "simd_capable": False,
            "note": f"Measured on {n_rows_sample:,} rows, extrapolated ×{scale_factor:.0f} to {n_rows_full:,}",
        }
    except Exception as e:
        print(f"  ERROR: {e}")
        return {"available": False, "error": str(e)[:200]}


def benchmark_postgres_vectorized(n_rows: int) -> dict:
    """
    Postgres: row-at-a-time Volcano model (real RDBMS baseline).

    Postgres uses the classic iterator model: each node pulls one tuple at a
    time from its child. No SIMD, no batch processing (except some specific
    indexes). Query execution is memory-bounded by work_mem.
    """
    print("\n" + "=" * 70)
    print("SYSTEM: Postgres — Row-at-a-time (Volcano iterator model, real RDBMS)")
    print("=" * 70)

    try:
        import psycopg2

        conn = psycopg2.connect(
            host=__import__("os").environ.get("POSTGRES_HOST", "localhost"),
            port=int(__import__("os").environ.get("POSTGRES_PORT", "5432")),
            dbname=__import__("os").environ.get("POSTGRES_DB", "benchmark"),
            user=__import__("os").environ.get("POSTGRES_USER", "postgres"),
            password=__import__("os").environ.get("POSTGRES_PASSWORD", ""),
            connect_timeout=5,
        )
        cursor = conn.cursor()

        # Create and populate a temp table for the vectorized benchmark
        print(f"  Loading {n_rows:,} rows into Postgres temp table...")
        cursor.execute("""
            CREATE TEMP TABLE vec_orders (
                order_id BIGINT,
                category TEXT,
                region TEXT,
                price DOUBLE PRECISION,
                quantity INTEGER,
                discount DOUBLE PRECISION,
                tax_rate DOUBLE PRECISION
            )
        """)

        # Generate data in Python and COPY into Postgres
        import io
        import random

        random.seed(42)
        categories = ["Electronics", "Clothing", "Books", "Food", "Sports", "Home", "Auto", "Health"]
        regions = ["East", "West", "North", "South", "Central"]

        buf = io.StringIO()
        chunk = min(n_rows, 200_000)
        for i in range(chunk):
            cat = categories[i % len(categories)]
            reg = regions[i % len(regions)]
            price = 10.0 + (i * 997 % 990000) / 10000.0
            qty = 1 + (i * 13) % 20
            disc = (i * 7 % 41) / 100.0
            tax = (i * 11 % 35) / 100.0
            buf.write(f"{i}\t{cat}\t{reg}\t{price:.4f}\t{qty}\t{disc:.4f}\t{tax:.4f}\n")

        buf.seek(0)
        cursor.copy_from(buf, "vec_orders", columns=["order_id", "category", "region", "price", "quantity", "discount", "tax_rate"])
        conn.commit()

        pg_query = """
            SELECT
                category, region,
                COUNT(*) AS order_count,
                SUM(price * quantity) AS gross_revenue,
                SUM(price * quantity * (1.0 - discount)) AS net_revenue,
                SUM(price * quantity * (1.0 - discount) * (1.0 - tax_rate)) AS after_tax_revenue,
                AVG(price) AS avg_price,
                STDDEV(price) AS price_stddev,
                MIN(price) AS min_price,
                MAX(price) AS max_price
            FROM vec_orders
            GROUP BY category, region
            ORDER BY after_tax_revenue DESC
        """

        cursor.execute(pg_query)
        cursor.fetchall()

        t_start = time.perf_counter()
        cursor.execute(pg_query)
        cursor.fetchall()
        elapsed_s = time.perf_counter() - t_start
        elapsed_ms = elapsed_s * 1000

        rows_processed = chunk
        rows_per_second = rows_processed / elapsed_s

        scale_factor = n_rows / chunk
        extrapolated_ms = elapsed_ms * scale_factor

        print(f"  Rows processed: {rows_processed:,} (extrapolated to {n_rows:,})")
        print(f"  Execution time: {elapsed_ms:.1f}ms (sample), {extrapolated_ms:.0f}ms (extrap.)")
        print(f"  Throughput:     {rows_per_second:,.0f} rows/sec")

        cursor.close()
        conn.close()

        return {
            "available": True,
            "execution_time_ms": round(extrapolated_ms, 2),
            "execution_time_ms_sample": round(elapsed_ms, 2),
            "rows_processed": n_rows,
            "rows_sampled": rows_processed,
            "rows_per_second": round(rows_per_second),
            "batch_model": "row-at-a-time (Volcano iterator model — PostgreSQL executor)",
            "vector_size": 1,
            "simd_capable": False,
            "note": f"Loaded {rows_processed:,} rows; extrapolated ×{scale_factor:.0f} to {n_rows:,}",
        }

    except Exception as e:
        print(f"  Postgres not available: {type(e).__name__}: {str(e)[:100]}")
        return {
            "available": False,
            "note": f"Postgres unavailable: {type(e).__name__}",
        }


def run_vectorized_benchmark() -> dict:
    """Run all execution model benchmarks and annotate with ConceptValidator."""

    print("\n" + "=" * 70)
    print(" USE CASE 6: VECTORIZED EXECUTION & SIMD")
    print(" Maps to CMU 15-721 Lectures 10-12")
    print("=" * 70)
    print(f" Started: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f" Rows: {N_ROWS_FULL:,} (DuckDB + NumPy), {N_ROWS_SCALAR:,} (scalar, extrapolated)")
    print(f" Query: heavy arithmetic (6 ops/row, 2 CASE, STDDEV, GROUP BY category×region)")
    print("=" * 70)

    _peak_capture = PeakMemoryCapture()
    _peak_capture.__enter__()
    try:
        # Run benchmarks
        duckdb_result = benchmark_duckdb_vectorized(N_ROWS_FULL)
        numpy_result = benchmark_numpy_vectorized(N_ROWS_FULL)
        scalar_result = benchmark_python_scalar(N_ROWS_SCALAR, N_ROWS_FULL)
        postgres_result = benchmark_postgres_vectorized(N_ROWS_FULL)

        # Compute speedups
        speedup = {}
        duck_ms = duckdb_result.get("execution_time_ms", 0) if duckdb_result.get("available") else 0
        numpy_ms = numpy_result.get("execution_time_ms", 0) if numpy_result.get("available") else 0
        scalar_ms = scalar_result.get("execution_time_ms", 0) if scalar_result.get("available") else 0
        pg_ms = postgres_result.get("execution_time_ms", 0) if postgres_result.get("available") else 0

        if duck_ms > 0:
            if scalar_ms > 0:
                speedup["duckdb_vs_python_scalar"] = round(scalar_ms / duck_ms, 1)
            if numpy_ms > 0:
                speedup["duckdb_vs_numpy"] = round(numpy_ms / duck_ms, 1)
            if pg_ms > 0:
                speedup["duckdb_vs_postgres"] = round(pg_ms / duck_ms, 1)
        if numpy_ms > 0 and scalar_ms > 0:
            speedup["numpy_vs_python_scalar"] = round(scalar_ms / numpy_ms, 1)

        # Concept validation
        validator = ConceptValidator()
        validation = validator.validate_vectorized_execution(
            duckdb_result=duckdb_result,
            numpy_result=numpy_result,
            scalar_result=scalar_result,
            postgres_result=postgres_result,
            speedup=speedup,
        )

        # Print validation
        ConceptValidator.print_validation(validation)

        result = {
            "use_case": 6,
            "benchmark": "vectorized_execution",
            "row_count": N_ROWS_FULL,
            "query": "Heavy arithmetic aggregation: SUM/STDDEV/CASE on 6 expressions per row",
            "systems": {
                "duckdb": duckdb_result,
                "numpy_vectorized": numpy_result,
                "python_scalar": scalar_result,
                "postgres": postgres_result,
            },
            "speedup": speedup,
            "validation": validation,
            "run_timestamp": datetime.now().isoformat(),
            "maps_to": "CMU 15-721 Lectures 10-12: Vectorized Execution, SIMD, Vectorized Operators",
        }
        _peak_capture.__exit__(None, None, None)
        inject_peak_memory(result, _peak_capture)

        # Save results
        output_dir = Path("results")
        output_dir.mkdir(exist_ok=True)
        output_file = output_dir / "use_case_6_vectorized_execution.json"
        with open(output_file, "w") as f:
            json.dump(result, f, indent=2, default=str)

        print(f"\n\U0001f4be Results saved: {output_file.resolve()}")
        return result
    finally:
        _peak_capture.__exit__(None, None, None)  # idempotent — no-op if already stopped


if __name__ == "__main__":
    run_vectorized_benchmark()
