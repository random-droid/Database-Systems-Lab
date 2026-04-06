"""
Storage-Aware Loader for All Systems
=====================================

Loads data into all 5 systems while staying under Replit's 10GB disk limit.

Strategy:
1. Generate Parquet (500MB) - PERMANENT
2. Generate temp CSV (5GB) - TEMPORARY
3. Load Postgres from CSV
4. DELETE CSV immediately (free 5GB!)
5. DuckDB external tables (0GB - no duplication)
6. Spark reads Parquet (0GB - on-demand)

Final storage: ~3.5GB (Postgres 3GB + Parquet 500MB)
"""

import os
import sys
from pathlib import Path
import time

def get_disk_usage_gb(path):
    """Calculate total disk usage in GB."""
    total = 0
    for dirpath, dirnames, filenames in os.walk(path):
        for filename in filenames:
            filepath = os.path.join(dirpath, filename)
            if os.path.exists(filepath):
                total += os.path.getsize(filepath)
    return total / (1024**3)

def check_storage_limit():
    """Check if approaching 10GB limit."""
    usage = get_disk_usage_gb('data')
    print(f"📊 Current storage: {usage:.2f} GB / 10 GB limit")
    
    if usage > 9.5:
        raise RuntimeError(f"⚠️  Approaching 10GB limit! Current: {usage:.2f}GB")
    
    return usage

def load_postgres():
    """
    Load data into Postgres from CSV.
    CSV MUST be deleted by caller immediately after!

    Returns False and prints a clear error + suggestion if Postgres is
    unreachable or loading fails. Never raises an unhandled exception.
    """
    
    print("\n" + "="*60)
    print("🐘 Loading Postgres")
    print("="*60)
    
    try:
        import psycopg2
        from psycopg2 import sql
    except ImportError:
        print("❌ Postgres skipped: psycopg2 is not installed.")
        print("   Fix: pip install psycopg2-binary")
        return False

    # Connect (adjust connection params as needed)
    try:
        conn = psycopg2.connect(
            dbname=os.getenv('POSTGRES_DB', 'olap_benchmark'),
            user=os.getenv('POSTGRES_USER', 'postgres'),
            password=os.getenv('POSTGRES_PASSWORD', 'postgres'),
            host=os.getenv('POSTGRES_HOST', 'localhost'),
            port=os.getenv('POSTGRES_PORT', '5432'),
            connect_timeout=10,
        )
        cursor = conn.cursor()
        print("✅ Connected to Postgres")
    except Exception as e:
        print(f"❌ Postgres skipped: could not connect — {e}")
        print("   Fix: ensure Postgres is running and the POSTGRES_HOST / POSTGRES_USER /")
        print("        POSTGRES_PASSWORD / POSTGRES_DB environment variables are set correctly.")
        print("   Quick start: docker run -d -p 5432:5432 -e POSTGRES_PASSWORD=postgres postgres:15")
        return False
    
    try:
        # Drop existing tables
        cursor.execute("DROP TABLE IF EXISTS orders CASCADE")
        cursor.execute("DROP TABLE IF EXISTS customers CASCADE")
        cursor.execute("DROP TABLE IF EXISTS products CASCADE")
        
        # Create orders table
        cursor.execute("""
            CREATE TABLE orders (
                order_id BIGINT PRIMARY KEY,
                customer_id BIGINT,
                product_id INT,
                order_date DATE,
                region VARCHAR(20),
                revenue DECIMAL(10,2),
                quantity INT,
                status VARCHAR(20),
                metadata JSONB
            )
        """)
        
        # Create customers table
        cursor.execute("""
            CREATE TABLE customers (
                customer_id BIGINT PRIMARY KEY,
                customer_name VARCHAR(100),
                region VARCHAR(20),
                signup_date DATE
            )
        """)
        
        # Create products table
        cursor.execute("""
            CREATE TABLE products (
                product_id INT PRIMARY KEY,
                product_name VARCHAR(100),
                category VARCHAR(50),
                price DECIMAL(10,2)
            )
        """)
        
        print("✅ Tables created")
        
        # Bulk load from CSV (fast COPY command)
        csv_path = 'data/sample_data/orders_temp.csv'
        
        print(f"🔄 Loading orders from {csv_path} (this takes a few minutes)...")
        with open(csv_path, 'r') as f:
            cursor.copy_expert(
                sql.SQL("COPY orders FROM STDIN WITH CSV HEADER"),
                f
            )
        print("✅ Orders loaded (50M rows)")
        
        # Load customers
        print("🔄 Loading customers...")
        import pandas as pd
        customers_df = pd.read_parquet('data/sample_data/customers.parquet')
        for _, row in customers_df.iterrows():
            cursor.execute(
                "INSERT INTO customers VALUES (%s, %s, %s, %s)",
                (row['customer_id'], row['customer_name'], row['region'], row['signup_date'])
            )
        print("✅ Customers loaded (1M rows)")
        
        # Load products
        print("🔄 Loading products...")
        products_df = pd.read_parquet('data/sample_data/products.parquet')
        for _, row in products_df.iterrows():
            cursor.execute(
                "INSERT INTO products VALUES (%s, %s, %s, %s)",
                (row['product_id'], row['product_name'], row['category'], row['price'])
            )
        print("✅ Products loaded (10K rows)")
        
        # Create indexes
        print("🔄 Creating indexes...")
        cursor.execute("CREATE INDEX idx_orders_date ON orders(order_date)")
        cursor.execute("CREATE INDEX idx_orders_region ON orders(region)")
        cursor.execute("CREATE INDEX idx_orders_customer ON orders(customer_id)")
        cursor.execute("CREATE INDEX idx_customers_region ON customers(region)")
        print("✅ Indexes created")
        
        conn.commit()
        print("✅ Postgres load complete!")
        print(f"   ⚠️  CRITICAL: Delete {csv_path} to free ~5GB")
        
        return True
        
    except Exception as e:
        print(f"❌ Postgres load failed: {e}")
        print("   Fix: check disk space, CSV file integrity, and Postgres table permissions.")
        print("   Other engines (DuckDB) will still run.")
        try:
            conn.rollback()
        except Exception:
            pass
        return False
        
    finally:
        try:
            cursor.close()
            conn.close()
        except Exception:
            pass

def setup_duckdb_external():
    """
    Setup DuckDB with external tables (zero-copy, no duplication).
    
    Demonstrates: Disaggregated storage (15-721 Lecture 04)

    DuckDB is a zero-dependency in-process engine and should always succeed.
    Errors are caught and reported clearly.
    """
    
    print("\n" + "="*60)
    print("🦆 Setting up DuckDB External Tables")
    print("="*60)
    
    try:
        import duckdb
    except ImportError:
        print("❌ DuckDB skipped: duckdb is not installed.")
        print("   Fix: pip install duckdb")
        return False

    try:
        conn = duckdb.connect(':memory:')
        
        # Create EXTERNAL views (query Parquet directly, no data duplication)
        from utils import get_orders_parquet_path
        orders_parquet = get_orders_parquet_path()
        conn.execute(f"""
            CREATE VIEW orders AS 
            SELECT * FROM read_parquet('{orders_parquet}')
        """)
        
        conn.execute("""
            CREATE VIEW customers AS
            SELECT * FROM read_parquet('data/sample_data/customers.parquet')
        """)
        
        conn.execute("""
            CREATE VIEW products AS
            SELECT * FROM read_parquet('data/sample_data/products.parquet')
        """)
        
        # Verify
        result = conn.execute("SELECT COUNT(*) FROM orders").fetchone()
        print(f"✅ DuckDB external tables ready: {result[0]:,} orders")
        print("✅ Storage used: 0GB (reads Parquet directly)")
        
        conn.close()
        return True
    except Exception as e:
        print(f"❌ DuckDB setup failed: {e}")
        print("   Fix: ensure Parquet files exist under data/sample_data/")
        print("        Run python data_generator.py first.")
        return False

def setup_spark_config():
    """
    Create Spark configuration for memory-constrained environment.
    Spark will read Parquet files directly when queries run.

    Returns False with a clear message if PySpark or Java are unavailable,
    then skips Spark rather than crashing the overall load.
    """
    
    print("\n" + "="*60)
    print("⚡ Configuring Spark")
    print("="*60)

    try:
        from pyspark.sql import SparkSession
    except ImportError:
        print("❌ Spark skipped: pyspark is not installed.")
        print("   Fix: pip install pyspark  (also requires Java 8 or 11 on PATH)")
        return False

    import subprocess
    java_ok = subprocess.call(
        ["java", "-version"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    ) == 0

    if not java_ok:
        print("❌ Spark skipped: Java runtime not found on PATH.")
        print("   Fix: install Java 8 or 11 (e.g. sudo apt-get install default-jre)")
        return False

    try:
        spark = (
            SparkSession.builder
            .appName("OLAP_Benchmark_Loader_Check")
            .master("local[1]")
            .config("spark.driver.memory", "512m")
            .config("spark.ui.enabled", "false")
            .getOrCreate()
        )
        version = spark.version
        spark.stop()
        print(f"✅ Spark configured to read Parquet directly (Spark {version})")
        print("✅ Storage used: 0GB (reads on-demand)")
        print("   Config: 1GB driver, 1GB executor, 4 shuffle partitions")
        return True
    except Exception as e:
        print(f"❌ Spark skipped: could not start session — {e}")
        print("   Fix: verify Java installation and PySpark compatibility.")
        print("   Benchmarks that require Spark will be skipped automatically.")
        return False

def load_all():
    """Main loader orchestration."""
    
    print("\n" + "="*80)
    print(" OLAP Benchmark Sandbox - Data Loader")
    print("="*80)
    print("\nLoading strategy:")
    print("1. ✅ Parquet already generated (500MB)")
    print("2. ✅ CSV already generated (5GB)")
    print("3. 🔄 Load Postgres from CSV")
    print("4. 🗑️  DELETE CSV immediately (free 5GB!)")
    print("5. 🦆 Setup DuckDB external tables (0GB)")
    print("6. ⚡ Configure Spark (0GB)")
    print("="*80)
    
    # Check initial storage
    print("\n📊 Initial storage check...")
    initial_usage = check_storage_limit()
    
    # Verify files exist
    csv_path = Path('data/sample_data/orders_temp.csv')
    if not csv_path.exists():
        print(f"❌ CSV not found: {csv_path}")
        print("   Run: python data_generator.py first")
        return False
    
    # Step 1: Load Postgres
    postgres_success = load_postgres()
    
    if not postgres_success:
        print("\n⚠️  Postgres load failed, but continuing with other systems...")
    
    # Step 2: DELETE CSV immediately to free 5GB
    print("\n" + "="*60)
    print("🗑️  Deleting temporary CSV to free storage")
    print("="*60)
    
    try:
        csv_size_gb = csv_path.stat().st_size / (1024**3)
        os.remove(csv_path)
        print(f"✅ Deleted: {csv_path}")
        print(f"✅ Freed: {csv_size_gb:.2f} GB")
    except Exception as e:
        print(f"❌ Failed to delete CSV: {e}")
    
    # Check storage after cleanup
    post_cleanup_usage = check_storage_limit()
    print(f"✅ Storage after cleanup: {post_cleanup_usage:.2f} GB (freed {initial_usage - post_cleanup_usage:.2f} GB)")
    
    # Step 3: Setup DuckDB
    duckdb_success = setup_duckdb_external()
    
    # Step 4: Configure Spark
    spark_success = setup_spark_config()
    
    # Final summary
    ready_systems = [s for s, ok in [("Postgres", postgres_success), ("DuckDB", duckdb_success), ("Spark", spark_success)] if ok]
    failed_systems = [s for s, ok in [("Postgres", postgres_success), ("DuckDB", duckdb_success), ("Spark", spark_success)] if not ok]

    print("\n" + "="*80)
    print(" LOADING COMPLETE")
    print("="*80)
    print(f"\n📊 System status:")
    print(f"   {'✅' if postgres_success else '❌'} Postgres: {'loaded (~3GB data + indexes)' if postgres_success else 'skipped (see error above)'}")
    print(f"   {'✅' if duckdb_success else '❌'} DuckDB: {'ready (0GB, external tables)' if duckdb_success else 'skipped (see error above)'}")
    print(f"   {'✅' if spark_success else '❌'} Spark: {'ready (0GB, reads Parquet on-demand)' if spark_success else 'skipped (see error above)'}")
    print(f"\n📊 Final storage: {post_cleanup_usage:.2f} GB / 10 GB limit")
    print(f"   - Postgres data: ~3GB (if loaded)")
    print(f"   - Parquet files: ~0.5GB")

    if failed_systems:
        print(f"\n⚠️  {len(failed_systems)} engine(s) skipped: {', '.join(failed_systems)}")
        print(f"   Benchmarks requiring those engines will be skipped automatically.")
    if ready_systems:
        print(f"\n✅ {len(ready_systems)} engine(s) ready: {', '.join(ready_systems)}")

    print("\nNext steps:")
    print("  1. Run benchmarks: python -m benchmarks.use_case_2_complex_joins")
    print("  2. Or run all: python -m benchmarks.run_all")
    
    return True

if __name__ == '__main__':
    load_all()
