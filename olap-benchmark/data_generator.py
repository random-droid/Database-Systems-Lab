"""
Data Generator for OLAP Benchmark Sandbox
==========================================

Generates e-commerce dataset:
- orders: 50M rows (~5GB CSV, 500MB Parquet)
- customers: 1M rows
- products: 10K rows

Plus schema evolution test:
- orders_evolved: 1M rows with NEW JSON field

Maps to CMU 15-721 concepts for validation.
"""

import pandas as pd
import numpy as np
from faker import Faker
from datetime import datetime, timedelta
import json
import os
import psutil

fake = Faker()
Faker.seed(42)  # Reproducible data
np.random.seed(42)


def auto_select_dataset_size():
    """
    Auto-detect available memory and select an appropriate dataset size.

    Thresholds:
        >= 1.5 GB available  →  50M rows  (full benchmark)
        >= 0.5 GB available  →  10M rows  (medium dataset)
        <  0.5 GB available  →   1M rows  (small / safe mode)

    Returns:
        int: Recommended number of rows for the orders table.
    """
    mem = psutil.virtual_memory()
    available_gb = mem.available / (1024 ** 3)

    if available_gb >= 1.5:
        num_rows = 50_000_000
        label = "full (50M rows)"
    elif available_gb >= 0.5:
        num_rows = 10_000_000
        label = "medium (10M rows)"
    else:
        num_rows = 1_000_000
        label = "small (1M rows)"

    print(f"🧠 Memory-aware dataset selection:")
    print(f"   Available RAM: {available_gb:.2f} GB")
    print(f"   Selected size: {label}")
    print(f"   Reason: {'Sufficient RAM for full benchmark' if num_rows == 50_000_000 else ('Low RAM – using medium dataset to stay within 80% memory usage limit' if num_rows == 10_000_000 else 'Very low RAM – using minimal dataset to avoid OOM')}")
    return num_rows

def generate_orders(num_rows=50_000_000):
    """
    Generate orders table with controlled distribution.
    
    Distribution:
    - Dates: 2020-2024 (evenly distributed)
    - Regions: 25% each (East/West/North/South)
    - Revenue: $10-$1000 (uniform random)
    - Metadata: JSON with 3 fields
    """
    
    print(f"🔄 Generating {num_rows:,} orders...")
    
    # Generate in chunks to avoid memory issues
    chunk_size = 5_000_000
    chunks = []
    proc = psutil.Process(os.getpid())
    
    for i in range(0, num_rows, chunk_size):
        current_chunk = min(chunk_size, num_rows - i)
        chunk_num = i // chunk_size + 1
        total_chunks = (num_rows - 1) // chunk_size + 1
        print(f"   Chunk {chunk_num}/{total_chunks}: {current_chunk:,} rows")

        # Per-chunk memory pressure check (halt if > 80% used)
        mem = psutil.virtual_memory()
        if mem.percent > 80:
            rss_mb = proc.memory_info().rss / (1024 ** 2)
            print(f"⚠️  Memory pressure too high: {mem.percent:.1f}% used "
                  f"(process RSS: {rss_mb:.0f} MB). Halting data generation.")
            print(f"   Generated {i:,} rows so far. Consider re-running with a smaller dataset.")
            print(f"   Tip: call auto_select_dataset_size() to pick a safer row count.")
            break

        # Generate data
        chunk_data = {
            'order_id': range(i, i + current_chunk),
            'customer_id': np.random.randint(1, 1_000_000, current_chunk),
            'product_id': np.random.randint(1, 10_000, current_chunk),
            'order_date': [
                datetime(2020, 1, 1) + timedelta(days=np.random.randint(0, 1461))
                for _ in range(current_chunk)
            ],
            'region': np.random.choice(['East', 'West', 'North', 'South'], current_chunk),
            'revenue': np.random.uniform(10, 1000, current_chunk).round(2),
            'quantity': np.random.randint(1, 10, current_chunk),
            'status': np.random.choice(['pending', 'shipped', 'delivered'], current_chunk),
        }
        
        # Generate metadata JSON
        metadata_list = []
        for _ in range(current_chunk):
            metadata = {
                'campaign_id': np.random.randint(1, 100),
                'source': np.random.choice(['web', 'mobile', 'tablet']),
                'type': np.random.choice(['regular', 'promotion'])
            }
            metadata_list.append(json.dumps(metadata))
        
        chunk_data['metadata'] = metadata_list
        
        chunk_df = pd.DataFrame(chunk_data)
        chunks.append(chunk_df)
    
    # Combine all chunks
    if not chunks:
        print("❌ No data generated — memory pressure was too high before the first chunk.")
        print("   Tip: free memory or call auto_select_dataset_size() to pick a smaller dataset.")
        return None

    orders_df = pd.concat(chunks, ignore_index=True)
    actual = len(orders_df)
    if actual < num_rows:
        print(f"⚠️  Partial dataset: generated {actual:,} of {num_rows:,} rows "
              f"(halted early due to memory pressure).")
    else:
        print(f"✅ Generated {actual:,} orders")
    
    return orders_df

def generate_orders_evolved(num_rows=1_000_000):
    """
    Generate evolved dataset with NEW JSON field for schema evolution test.
    
    NEW FIELD: 'new_discount_code' in metadata
    
    Tests: Can systems handle new fields without schema update?
    """
    
    print(f"🔄 Generating {num_rows:,} evolved orders (with new JSON field)...")
    
    chunk_data = {
        'order_id': range(50_000_000, 50_000_000 + num_rows),
        'customer_id': np.random.randint(1, 1_000_000, num_rows),
        'product_id': np.random.randint(1, 10_000, num_rows),
        'order_date': [
            datetime(2024, 1, 1) + timedelta(days=np.random.randint(0, 90))
            for _ in range(num_rows)
        ],
        'region': np.random.choice(['East', 'West', 'North', 'South'], num_rows),
        'revenue': np.random.uniform(10, 1000, num_rows).round(2),
        'quantity': np.random.randint(1, 10, num_rows),
        'status': np.random.choice(['pending', 'shipped', 'delivered'], num_rows),
    }
    
    # Generate metadata with NEW FIELD
    metadata_list = []
    for _ in range(num_rows):
        metadata = {
            'campaign_id': np.random.randint(1, 100),
            'source': np.random.choice(['web', 'mobile', 'tablet']),
            'type': np.random.choice(['regular', 'promotion']),
            'new_discount_code': f"DISC-{fake.lexify('????')}"  # NEW FIELD!
        }
        metadata_list.append(json.dumps(metadata))
    
    chunk_data['metadata'] = metadata_list
    
    evolved_df = pd.DataFrame(chunk_data)
    print(f"✅ Generated {len(evolved_df):,} evolved orders")
    
    return evolved_df

def generate_customers(num_rows=1_000_000):
    """Generate customers table."""
    
    print(f"🔄 Generating {num_rows:,} customers...")
    
    data = {
        'customer_id': range(1, num_rows + 1),
        'customer_name': [fake.name() for _ in range(num_rows)],
        'region': np.random.choice(['East', 'West', 'North', 'South'], num_rows),
        'signup_date': [
            datetime(2018, 1, 1) + timedelta(days=np.random.randint(0, 2000))
            for _ in range(num_rows)
        ],
    }
    
    customers_df = pd.DataFrame(data)
    print(f"✅ Generated {len(customers_df):,} customers")
    
    return customers_df

def generate_products(num_rows=10_000):
    """Generate products table."""
    
    print(f"🔄 Generating {num_rows:,} products...")
    
    categories = ['Electronics', 'Clothing', 'Home', 'Books', 'Sports', 'Toys']
    
    data = {
        'product_id': range(1, num_rows + 1),
        'product_name': [fake.catch_phrase() for _ in range(num_rows)],
        'category': np.random.choice(categories, num_rows),
        'price': np.random.uniform(5, 500, num_rows).round(2),
    }
    
    products_df = pd.DataFrame(data)
    print(f"✅ Generated {len(products_df):,} products")
    
    return products_df

def save_as_parquet(df, filename):
    """Save dataframe as Parquet with compression."""
    
    os.makedirs('data/sample_data', exist_ok=True)
    filepath = f'data/sample_data/{filename}'
    
    df.to_parquet(filepath, compression='snappy', index=False)
    
    # Get file size
    size_mb = os.path.getsize(filepath) / (1024**2)
    print(f"💾 Saved: {filepath} ({size_mb:.1f} MB)")
    
    return filepath

def save_as_csv_for_postgres(df, filename):
    """
    Save as CSV for Postgres bulk load.
    WARNING: This file must be deleted immediately after loading!
    """
    
    os.makedirs('data/sample_data', exist_ok=True)
    filepath = f'data/sample_data/{filename}'
    
    df.to_csv(filepath, index=False)
    
    # Get file size
    size_gb = os.path.getsize(filepath) / (1024**3)
    print(f"💾 Saved: {filepath} ({size_gb:.2f} GB)")
    print(f"⚠️  WARNING: This CSV must be deleted after Postgres load to free {size_gb:.2f}GB")
    
    return filepath

def main():
    """Generate all datasets."""
    
    print("=" * 60)
    print("OLAP Benchmark Data Generator")
    print("=" * 60)
    
    # Step 0: Auto-select dataset size based on available memory
    num_orders = auto_select_dataset_size()
    print()

    # Step 1: Generate base datasets
    orders_df = generate_orders(num_orders)
    if orders_df is None:
        print("❌ Cannot continue: orders data generation failed (see memory error above).")
        return
    customers_df = generate_customers(1_000_000)
    products_df = generate_products(10_000)
    
    # Step 2: Generate schema evolution dataset
    orders_evolved_df = generate_orders_evolved(1_000_000)
    
    # Step 3: Save as Parquet (efficient, permanent)
    # Use the actual row count in the filename to avoid confusion when
    # auto_select_dataset_size() picks a smaller dataset than the full 50M.
    orders_row_label = f"{num_orders // 1_000_000}M"
    orders_parquet_name = f'orders_base_{orders_row_label}.parquet'

    print("\n📦 Saving as Parquet (permanent)...")
    save_as_parquet(orders_df, orders_parquet_name)
    save_as_parquet(customers_df, 'customers.parquet')
    save_as_parquet(products_df, 'products.parquet')
    save_as_parquet(orders_evolved_df, 'orders_evolved_1M.parquet')

    # Step 4: Save orders as CSV for Postgres (temporary)
    print("\n📦 Saving as CSV for Postgres (TEMPORARY - will be deleted)...")
    save_as_csv_for_postgres(orders_df, 'orders_temp.csv')

    print("\n" + "=" * 60)
    print("✅ Data generation complete!")
    print("=" * 60)
    print("\nGenerated files:")
    print("  Parquet (permanent):")
    print(f"    - {orders_parquet_name}")
    print("    - orders_evolved_1M.parquet (~10MB)")
    print("    - customers.parquet (~50MB)")
    print("    - products.parquet (~1MB)")
    print("\n  CSV (temporary):")
    print("    - orders_temp.csv - DELETE after Postgres load!")
    print("\nNext step: Run loaders/load_all.py")

if __name__ == '__main__':
    main()
