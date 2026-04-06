"""
OLAP Benchmark utilities.
"""

import glob as _glob
import os as _os


def get_orders_parquet_path(base_dir: str = "data/sample_data") -> str:
    """
    Return the path to the orders base Parquet file regardless of which
    dataset size was generated (1M, 10M, or 50M rows).

    The data generator writes ``orders_base_{N}M.parquet`` using the actual
    selected row count.  This helper discovers whichever variant exists so
    that loaders and benchmarks do not need to hard-code "50M".

    Selection policy: most recently modified file wins.  This ensures that if
    ``data_generator.py`` re-ran and chose a smaller dataset (e.g. 10M instead
    of a stale 50M), the fresh file is used.

    Args:
        base_dir: Directory that contains the sample data files.

    Returns:
        Relative path string suitable for use in DuckDB ``read_parquet()``
        and PySpark ``spark.read.parquet()``.

    Raises:
        FileNotFoundError: When no matching Parquet file is found.
    """
    candidates = sorted(
        _glob.glob(_os.path.join(base_dir, "orders_base_*.parquet")),
        key=lambda p: _os.path.getmtime(p) if _os.path.exists(p) else 0,
        reverse=True,
    )
    if not candidates:
        raise FileNotFoundError(
            f"No orders_base_*.parquet file found in '{base_dir}'. "
            "Run data_generator.py first."
        )
    return candidates[0]
