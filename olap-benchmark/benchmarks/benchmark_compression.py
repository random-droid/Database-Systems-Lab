"""
Use Case 7: Compression Effectiveness
======================================

Demonstrates why columnar Parquet storage dominates CSV for OLAP workloads.

Tests: How much smaller is Parquet? How much faster is it to scan?

Maps to CMU 15-721:
- Lecture 03: Storage Models (columnar vs row, compression schemes)
- Lecture 07: Vectorized Execution (compressed data = less I/O)

Compression techniques demonstrated:
- Dictionary encoding   (low-cardinality string columns: region, category)
- RLE / bit-packing     (integer and flag columns)
- Snappy/Zstd codec     (block-level compression)

Expected Results:
- Parquet: 5-15x smaller than raw CSV
- Parquet scan: 2-10x faster than CSV (less I/O + predicate pushdown)
- Dictionary columns (region, category): highest compression ratios
"""

import sys
import json
import os
import shutil
import tempfile
import time
from pathlib import Path
from datetime import datetime

sys.path.append(str(Path(__file__).parent.parent))

from utils.concept_validator import ConceptValidator

N_ROWS = 10_000_000   # 10M rows

# Aggregation query used for scan benchmarks (same SQL, different source format)
SCAN_QUERY_TEMPLATE = """
SELECT
    category,
    region,
    COUNT(*) AS order_count,
    SUM(price * quantity) AS gross_revenue,
    AVG(price) AS avg_price
FROM {table_ref}
GROUP BY category, region
ORDER BY gross_revenue DESC
"""


def _generate_data(conn, n_rows: int):
    """Generate synthetic e-commerce data with realistic cardinality."""
    conn.execute(f"""
        CREATE OR REPLACE TABLE orders AS
        SELECT
            range::BIGINT AS order_id,
            (10000000 + range) AS customer_id,
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
            (10.0 + (abs(hash(range + 2)) % 990000) / 10000.0)::DOUBLE AS price,
            (1 + abs(hash(range + 3)) % 20)::INTEGER AS quantity,
            (abs(hash(range + 4)) % 41) / 100.0::DOUBLE AS discount,
            (abs(hash(range + 5)) % 2 = 0)::BOOLEAN AS is_premium,
            ('2023-01-01'::DATE + ((abs(hash(range + 6)) % 730)::INTEGER)) AS order_date
        FROM range({n_rows})
    """)
    print(f"  Generated {n_rows:,} rows in DuckDB")


def measure_format(
    conn, path: str, fmt: str, fmt_opts: str, n_rows: int, tmp_dir: str
) -> dict:
    """Export data to a format, measure size + scan speed."""
    import duckdb

    file_path = os.path.join(tmp_dir, f"orders.{fmt}")

    # Write
    print(f"\n  Writing {fmt.upper()} ({fmt_opts or 'default'})...")
    t_write = time.perf_counter()
    conn.execute(f"COPY orders TO '{file_path}' ({fmt_opts})")
    write_ms = (time.perf_counter() - t_write) * 1000

    # File size
    size_bytes = os.path.getsize(file_path)
    size_mb = size_bytes / (1024 ** 2)
    print(f"    File size: {size_mb:.1f} MB  ({size_bytes:,} bytes)")
    print(f"    Write time: {write_ms:.0f}ms")

    # Scan — use a fresh connection so no caching from the write connection
    scan_conn = duckdb.connect(":memory:")
    if fmt == "csv":
        table_ref = f"read_csv_auto('{file_path}')"
    elif fmt == "parquet":
        table_ref = f"read_parquet('{file_path}')"
    else:
        table_ref = f"read_csv_auto('{file_path}')"

    query = SCAN_QUERY_TEMPLATE.format(table_ref=table_ref)

    # Warmup
    scan_conn.execute(query).fetchall()

    # Timed scan
    t_scan = time.perf_counter()
    result = scan_conn.execute(query).fetchall()
    scan_ms = (time.perf_counter() - t_scan) * 1000
    scan_conn.close()

    rows_per_second = n_rows / (scan_ms / 1000) if scan_ms > 0 else 0
    print(f"    Scan time: {scan_ms:.1f}ms  ({rows_per_second:,.0f} rows/sec)")

    return {
        "format": fmt,
        "options": fmt_opts,
        "file_path": file_path,
        "size_bytes": size_bytes,
        "size_mb": round(size_mb, 2),
        "write_time_ms": round(write_ms, 1),
        "scan_time_ms": round(scan_ms, 1),
        "rows_per_second": round(rows_per_second),
    }


def run_compression_benchmark() -> dict:
    """Compare CSV vs Parquet size and scan speed."""

    print("\n" + "=" * 70)
    print(" USE CASE 7: COMPRESSION EFFECTIVENESS")
    print(" Maps to CMU 15-721 Lecture 03 (Storage Models)")
    print("=" * 70)
    print(f" Started: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f" Rows: {N_ROWS:,}")
    print(" Formats: CSV (uncompressed) vs Parquet (Snappy) vs Parquet (Zstd)")
    print("=" * 70)

    try:
        import duckdb
    except ImportError:
        print("  ❌ duckdb not installed — run: pip install duckdb")
        return {"error": "duckdb not installed"}

    tmp_dir = tempfile.mkdtemp(prefix="compression_benchmark_")
    conn = duckdb.connect(":memory:")

    try:
        _generate_data(conn, N_ROWS)

        print("\n" + "=" * 70)
        print("FORMAT 1: CSV (no compression)")
        print("=" * 70)
        csv_result = measure_format(
            conn, "csv_plain", "csv", "FORMAT CSV, HEADER true", N_ROWS, tmp_dir
        )

        print("\n" + "=" * 70)
        print("FORMAT 2: Parquet (Snappy codec — default)")
        print("=" * 70)
        parquet_snappy = measure_format(
            conn, "parquet_snappy", "parquet", "FORMAT PARQUET, CODEC SNAPPY", N_ROWS, tmp_dir
        )

        print("\n" + "=" * 70)
        print("FORMAT 3: Parquet (Zstd codec — high compression)")
        print("=" * 70)
        parquet_zstd = measure_format(
            conn, "parquet_zstd", "parquet", "FORMAT PARQUET, CODEC ZSTD", N_ROWS, tmp_dir
        )

    finally:
        conn.close()
        shutil.rmtree(tmp_dir, ignore_errors=True)

    # Compute comparisons
    csv_size = csv_result["size_bytes"]
    snappy_size = parquet_snappy["size_bytes"]
    zstd_size = parquet_zstd["size_bytes"]

    snappy_ratio = round(csv_size / snappy_size, 2) if snappy_size > 0 else 0
    zstd_ratio = round(csv_size / zstd_size, 2) if zstd_size > 0 else 0

    csv_scan = csv_result["scan_time_ms"]
    snappy_scan = parquet_snappy["scan_time_ms"]
    zstd_scan = parquet_zstd["scan_time_ms"]

    scan_speedup_snappy = round(csv_scan / snappy_scan, 2) if snappy_scan > 0 else 0
    scan_speedup_zstd = round(csv_scan / zstd_scan, 2) if zstd_scan > 0 else 0

    comparison = {
        "csv_vs_parquet_snappy": {
            "size_ratio": snappy_ratio,
            "scan_speedup": scan_speedup_snappy,
        },
        "csv_vs_parquet_zstd": {
            "size_ratio": zstd_ratio,
            "scan_speedup": scan_speedup_zstd,
        },
    }

    print("\n" + "=" * 70)
    print("COMPRESSION SUMMARY")
    print("=" * 70)
    print(f"  CSV:              {csv_result['size_mb']:.1f} MB  (baseline)")
    print(f"  Parquet (Snappy): {parquet_snappy['size_mb']:.1f} MB  ({snappy_ratio}x smaller)")
    print(f"  Parquet (Zstd):   {parquet_zstd['size_mb']:.1f} MB  ({zstd_ratio}x smaller)")
    print(f"  Scan speedup (Snappy): {scan_speedup_snappy}x faster than CSV")
    print(f"  Scan speedup (Zstd):   {scan_speedup_zstd}x faster than CSV")

    # Concept validation
    validator = ConceptValidator()
    validation = validator.validate_compression(
        csv_result=csv_result,
        parquet_snappy=parquet_snappy,
        parquet_zstd=parquet_zstd,
        comparison=comparison,
    )
    ConceptValidator.print_validation(validation)

    result = {
        "use_case": 7,
        "benchmark": "compression_effectiveness",
        "row_count": N_ROWS,
        "formats": {
            "csv": csv_result,
            "parquet_snappy": parquet_snappy,
            "parquet_zstd": parquet_zstd,
        },
        "comparison": comparison,
        "validation": validation,
        "run_timestamp": datetime.now().isoformat(),
        "maps_to": "CMU 15-721 Lecture 03: Storage Models (columnar compression)",
    }

    output_dir = Path("results")
    output_dir.mkdir(exist_ok=True)
    output_file = output_dir / "use_case_7_compression.json"
    with open(output_file, "w") as f:
        json.dump(result, f, indent=2, default=str)

    print(f"\n\U0001f4be Results saved: {output_file.resolve()}")
    return result


if __name__ == "__main__":
    run_compression_benchmark()
