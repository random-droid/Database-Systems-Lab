"""
Pre-flight Validation Script
=============================

Checks the environment before running the OLAP benchmark pipeline.
Validates memory, disk space, Postgres, Spark, and required Python packages.

Usage:
    python test_pipeline.py
"""

import sys
import os

PASS = "PASS"
FAIL = "FAIL"
WARN = "WARN"


def _fmt(status, label, detail, suggestion=None):
    icon = {"PASS": "✅", "FAIL": "❌", "WARN": "⚠️ "}.get(status, "ℹ️ ")
    print(f"  {icon} [{status}] {label}: {detail}")
    if suggestion and status in (FAIL, WARN):
        print(f"        → {suggestion}")


# ---------------------------------------------------------------------------
# 1. Memory check
# ---------------------------------------------------------------------------

def check_memory():
    """Check available memory and return (status, available_gb)."""
    print("\n[1/5] Memory")
    try:
        import psutil
        mem = psutil.virtual_memory()
        available_gb = mem.available / (1024 ** 3)
        total_gb = mem.total / (1024 ** 3)

        if available_gb >= 1.0:
            status = PASS
        elif available_gb >= 0.5:
            status = WARN
        else:
            status = FAIL

        _fmt(
            status,
            "Available RAM",
            f"{available_gb:.2f} GB available / {total_gb:.2f} GB total",
            "Close other processes or reduce dataset size to 1M rows." if status != PASS else None,
        )
        return status, available_gb
    except ImportError:
        _fmt(FAIL, "Available RAM", "psutil not installed",
             "pip install psutil")
        return FAIL, 0.0


# ---------------------------------------------------------------------------
# 2. Disk check
# ---------------------------------------------------------------------------

def check_disk():
    """Check free disk space."""
    print("\n[2/5] Disk Space")
    try:
        import shutil
        total, used, free = shutil.disk_usage(".")
        free_gb = free / (1024 ** 3)
        total_gb = total / (1024 ** 3)

        if free_gb >= 4.0:
            status = PASS
        elif free_gb >= 1.0:
            status = WARN
        else:
            status = FAIL

        _fmt(
            status,
            "Free disk",
            f"{free_gb:.2f} GB free / {total_gb:.2f} GB total",
            "Delete temporary CSV files or other large files to free space." if status != PASS else None,
        )
        return status, free_gb
    except Exception as exc:
        _fmt(FAIL, "Free disk", f"Could not determine: {exc}")
        return FAIL, 0.0


# ---------------------------------------------------------------------------
# 3. Postgres reachability check
# ---------------------------------------------------------------------------

def check_postgres():
    """Try connecting to Postgres using environment variables."""
    print("\n[3/5] Postgres")
    try:
        import psycopg2
    except ImportError:
        _fmt(FAIL, "Postgres (psycopg2)", "psycopg2 not installed",
             "pip install psycopg2-binary")
        return FAIL

    try:
        conn = psycopg2.connect(
            dbname=os.getenv("POSTGRES_DB", "olap_benchmark"),
            user=os.getenv("POSTGRES_USER", "postgres"),
            password=os.getenv("POSTGRES_PASSWORD", "postgres"),
            host=os.getenv("POSTGRES_HOST", "localhost"),
            port=os.getenv("POSTGRES_PORT", "5432"),
            connect_timeout=5,
        )
        conn.close()
        _fmt(PASS, "Postgres connection",
             f"Connected to {os.getenv('POSTGRES_HOST', 'localhost')}:{os.getenv('POSTGRES_PORT', '5432')}")
        return PASS
    except Exception as exc:
        _fmt(
            FAIL,
            "Postgres connection",
            str(exc),
            "Start Postgres or set POSTGRES_HOST/POSTGRES_USER/POSTGRES_PASSWORD/POSTGRES_DB env vars. "
            "Quick start: docker run -d -p 5432:5432 -e POSTGRES_PASSWORD=postgres postgres:15",
        )
        return FAIL


# ---------------------------------------------------------------------------
# 4. Spark availability check
# ---------------------------------------------------------------------------

def check_spark():
    """Check if PySpark can be imported and a session can be created."""
    print("\n[4/5] Spark")
    try:
        from pyspark.sql import SparkSession
    except ImportError:
        _fmt(FAIL, "PySpark import", "pyspark not installed",
             "pip install pyspark  (requires Java 8+ on PATH)")
        return FAIL

    import subprocess
    java_ok = subprocess.call(
        ["java", "-version"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    ) == 0

    if not java_ok:
        _fmt(FAIL, "Java runtime", "java not found on PATH",
             "Install Java 8 or 11: sudo apt-get install default-jre  (or set JAVA_HOME)")
        return FAIL

    try:
        spark = (
            SparkSession.builder
            .appName("pre_flight_check")
            .master("local[1]")
            .config("spark.driver.memory", "512m")
            .config("spark.ui.enabled", "false")
            .getOrCreate()
        )
        version = spark.version
        spark.stop()
        _fmt(PASS, "Spark session", f"Started successfully (Spark {version})")
        return PASS
    except Exception as exc:
        _fmt(FAIL, "Spark session", str(exc),
             "Check Java installation and PySpark version compatibility.")
        return FAIL


# ---------------------------------------------------------------------------
# 5. Required Python packages check
# ---------------------------------------------------------------------------

REQUIRED_PACKAGES = [
    ("pandas", "pandas"),
    ("numpy", "numpy"),
    ("pyarrow", "pyarrow"),
    ("duckdb", "duckdb"),
    ("psutil", "psutil"),
    ("faker", "Faker"),
    ("psycopg2", "psycopg2"),
]


def check_packages():
    """Check that all required Python packages can be imported."""
    print("\n[5/5] Required Python Packages")
    results = []
    for install_name, import_name in REQUIRED_PACKAGES:
        try:
            mod = __import__(import_name)
            version = getattr(mod, "__version__", "unknown")
            _fmt(PASS, install_name, f"v{version}")
            results.append(PASS)
        except ImportError:
            _fmt(FAIL, install_name, "not installed",
                 f"pip install {install_name}")
            results.append(FAIL)

    return FAIL if FAIL in results else PASS


# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------

def main():
    print("=" * 60)
    print("OLAP Benchmark Pipeline — Pre-flight Validation")
    print("=" * 60)

    mem_status, available_gb = check_memory()
    disk_status, free_gb = check_disk()
    pg_status = check_postgres()
    spark_status = check_spark()
    pkg_status = check_packages()

    print("\n" + "=" * 60)
    print("Summary")
    print("=" * 60)

    checks = [
        ("Memory", mem_status),
        ("Disk Space", disk_status),
        ("Postgres", pg_status),
        ("Spark", spark_status),
        ("Packages", pkg_status),
    ]

    all_pass = True
    for label, status in checks:
        icon = {"PASS": "✅", "FAIL": "❌", "WARN": "⚠️ "}.get(status, "ℹ️ ")
        print(f"  {icon} {label}: {status}")
        if status == FAIL:
            all_pass = False

    print()
    if all_pass:
        print("✅ All checks passed — pipeline is ready to run.")
    else:
        print("❌ One or more checks failed — address the issues above before running the pipeline.")
        print("   Note: Postgres and Spark failures will cause those engines to be skipped.")
        print("   DuckDB will always work as a fallback.")

    print("=" * 60)

    # Recommend dataset size based on available memory
    print("\nRecommended dataset size based on available memory:")
    if available_gb >= 1.5:
        size = "50M rows (full dataset)"
    elif available_gb >= 0.5:
        size = "10M rows (medium dataset)"
    else:
        size = "1M rows (small dataset)"
    print(f"  → {size} ({available_gb:.2f} GB available RAM)")
    print("=" * 60)

    return 0 if all_pass else 1


if __name__ == "__main__":
    sys.exit(main())
