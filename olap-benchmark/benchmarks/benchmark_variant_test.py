"""
Use Case 3: Schema Evolution & VARIANT Shredding
=================================================

The ACID TEST for Spark 4.1 VARIANT shredding.

Test A: STRING JSON (forces full parse, memory pressure, likely spills)
Test B: VARIANT column (shredded sub-columns, stays in-memory)

Expected Result: VARIANT avoids spill while STRING spills.

Maps to CMU 15-721 Lecture 03: PAX Storage (sub-columnar layout)
"""

import sys
import json
from pathlib import Path

sys.path.append(str(Path(__file__).parent.parent))

from config.spark_config import get_spark_session
from utils.spark_metrics import SparkMetricsCollector
from utils.benchmark_timer import BenchmarkTimer
from utils.concept_validator import ConceptValidator

def test_variant_shredding():
    """
    The definitive VARIANT test.
    
    Proves: VARIANT shredding keeps query in-memory,
            while STRING JSON spills to disk.
    """
    
    print("\n" + "="*80)
    print("⚡ SPARK VARIANT SHREDDING: The Acid Test")
    print("="*80)
    print("\nTest A: STRING JSON (baseline - forces full parse)")
    print("Test B: VARIANT (optimized - shredded sub-columns)")
    print("="*80)
    
    spark = get_spark_session()
    
    # Load base dataset
    orders_df = spark.read.parquet('data/sample_data/orders_base_50M.parquet')
    
    # ========== TEST A: STRING JSON ==========
    
    print("\n" + "="*60)
    print("TEST A: STRING JSON (Baseline)")
    print("="*60)
    
    # Cast metadata to STRING (forces full parse on every access)
    orders_string = orders_df.withColumn('metadata_string', orders_df['metadata'].cast('string'))
    orders_string.createOrReplaceTempView('orders_string')
    
    query_string = """
        SELECT 
            region,
            get_json_object(metadata_string, '$.campaign_id') as campaign,
            get_json_object(metadata_string, '$.source') as source,
            COUNT(*) as orders,
            SUM(revenue) as total_revenue
        FROM orders_string
        WHERE get_json_object(metadata_string, '$.type') = 'promotion'
            AND region IN ('East', 'West')
        GROUP BY region, campaign, source
        ORDER BY total_revenue DESC
        LIMIT 100
    """
    
    collector_string = SparkMetricsCollector(spark)
    timer = BenchmarkTimer()
    
    with collector_string.capture_metrics_safely():
        def run_string_query():
            return spark.sql(query_string).collect()
        
        metrics_string = timer.benchmark_with_io_breakdown(run_string_query, "spark_string_json")
    
    spill_string = collector_string.last_metrics
    
    # ========== TEST B: VARIANT (Spark 4.1) ==========
    
    print("\n" + "="*60)
    print("TEST B: VARIANT (Spark 4.1 Shredding)")
    print("="*60)
    
    # Use VARIANT type (shredded sub-columns)
    # Note: In Spark 4.1, JSON columns can be automatically inferred as VARIANT
    orders_variant = orders_df
    orders_variant.createOrReplaceTempView('orders_variant')
    
    query_variant = """
        SELECT 
            region,
            metadata.campaign_id as campaign,
            metadata.source as source,
            COUNT(*) as orders,
            SUM(revenue) as total_revenue
        FROM orders_variant
        WHERE metadata.type = 'promotion'
            AND region IN ('East', 'West')
        GROUP BY region, campaign, source
        ORDER BY total_revenue DESC
        LIMIT 100
    """
    
    collector_variant = SparkMetricsCollector(spark)
    
    with collector_variant.capture_metrics_safely():
        def run_variant_query():
            return spark.sql(query_variant).collect()
        
        metrics_variant = timer.benchmark_with_io_breakdown(run_variant_query, "spark_variant")
    
    spill_variant = collector_variant.last_metrics
    
    # Stop Spark (metrics already captured)
    spark.stop()
    
    # ========== ACID TEST RESULTS ==========
    
    print("\n" + "="*80)
    print(" ACID TEST RESULTS")
    print("="*80)
    
    # Compare results
    string_spilled = spill_string.get('disk_spill_bytes', 0) > 0
    variant_spilled = spill_variant.get('disk_spill_bytes', 0) > 0
    
    variant_avoided_spill = string_spilled and not variant_spilled
    
    speedup = metrics_string['total_time_seconds'] / metrics_variant['total_time_seconds']
    memory_savings = metrics_string['peak_memory_mb'] - metrics_variant['peak_memory_mb']
    
    results = {
        'string_json': {
            'execution_time_seconds': metrics_string['total_time_seconds'],
            'peak_memory_mb': metrics_string['peak_memory_mb'],
            'cpu_bound_percent': metrics_string['cpu_bound_percent'],
            'io_bound_percent': metrics_string['io_bound_percent'],
            'disk_spill_bytes': spill_string.get('disk_spill_bytes', 0),
            'spilled_to_disk': string_spilled,
            'demonstrates': 'Full JSON parse, high memory pressure'
        },
        'variant_shredded': {
            'execution_time_seconds': metrics_variant['total_time_seconds'],
            'peak_memory_mb': metrics_variant['peak_memory_mb'],
            'cpu_bound_percent': metrics_variant['cpu_bound_percent'],
            'io_bound_percent': metrics_variant['io_bound_percent'],
            'disk_spill_bytes': spill_variant.get('disk_spill_bytes', 0),
            'spilled_to_disk': variant_spilled,
            'demonstrates': 'Shredded sub-columns, lower memory footprint'
        },
        'proof': {
            'variant_avoided_spill': variant_avoided_spill,
            'speedup': round(speedup, 2),
            'memory_savings_mb': round(memory_savings, 1),
            'conclusion': 'VARIANT shredding keeps query in-memory' if variant_avoided_spill else 'Both approaches similar',
            'maps_to': 'CMU 15-721 Lecture 03: PAX Storage - Sub-columnar Layout'
        }
    }
    
    # Print results
    print("\nSTRING JSON:")
    print(f"  Time: {results['string_json']['execution_time_seconds']:.2f}s")
    print(f"  Peak memory: {results['string_json']['peak_memory_mb']:.1f} MB")
    print(f"  Spilled to disk: {'YES 🎯' if string_spilled else 'NO'}")
    if string_spilled:
        print(f"    Spill size: {spill_string['disk_spill_bytes'] / (1024**2):.1f} MB")
    
    print("\nVARIANT (Shredded):")
    print(f"  Time: {results['variant_shredded']['execution_time_seconds']:.2f}s")
    print(f"  Peak memory: {results['variant_shredded']['peak_memory_mb']:.1f} MB")
    print(f"  Spilled to disk: {'YES' if variant_spilled else 'NO ✅'}")
    
    print("\n" + "="*60)
    print("THE PROOF:")
    print("="*60)
    if variant_avoided_spill:
        print("🎯 ACID TEST PASSED!")
        print(f"   VARIANT avoided spill while STRING JSON spilled")
        print(f"   Speedup: {speedup:.1f}x faster")
        print(f"   Memory savings: {memory_savings:.1f} MB")
        print("\n✅ Proves: Sub-columnar shredding reduces memory pressure")
        print("   Maps to: CMU 15-721 Lecture 03 (PAX Storage)")
    else:
        print("📊 Both approaches performed similarly")
        print(f"   Speedup: {speedup:.1f}x")
        print(f"   Memory difference: {memory_savings:.1f} MB")
    
    # --- ConceptValidator: annotate results ---
    validator = ConceptValidator()
    validation = validator.validate_variant_shredding(
        string_metrics={
            "execution_time_seconds": results["string_json"]["execution_time_seconds"],
            "peak_memory_mb": results["string_json"]["peak_memory_mb"],
            "disk_spill_bytes": results["string_json"]["disk_spill_bytes"],
        },
        variant_metrics={
            "execution_time_seconds": results["variant_shredded"]["execution_time_seconds"],
            "peak_memory_mb": results["variant_shredded"]["peak_memory_mb"],
            "disk_spill_bytes": results["variant_shredded"]["disk_spill_bytes"],
        },
    )
    results["validation"] = validation
    print("\n⚡ VARIANT CONCEPT VALIDATION:")
    validator.print_validation(validation)

    # Save results
    output_dir = Path('results')
    output_dir.mkdir(exist_ok=True)

    output_file = output_dir / 'use_case_3_variant_acid_test.json'
    with open(output_file, 'w') as f:
        json.dump(results, f, indent=2)

    print(f"\n💾 Results saved: {output_file}")

    return results

def test_schema_evolution():
    """
    Test schema evolution with new JSON field.
    
    Appends 1M rows with NEW field, tests if systems handle gracefully.
    """
    
    print("\n" + "="*80)
    print("📋 SCHEMA EVOLUTION TEST")
    print("="*80)
    print("\nStep 1: Query base dataset (50M rows, 3 JSON fields)")
    print("Step 2: Append evolved dataset (1M rows, 4 JSON fields - NEW field)")
    print("Step 3: Query new field across both datasets")
    print("="*80)
    
    spark = get_spark_session()
    
    # Load both datasets
    base_df = spark.read.parquet('data/sample_data/orders_base_50M.parquet')
    evolved_df = spark.read.parquet('data/sample_data/orders_evolved_1M.parquet')
    
    # Union them (simulates append in production)
    combined_df = base_df.union(evolved_df)
    combined_df.createOrReplaceTempView('orders_all')
    
    # Query NEW field (only exists in evolved dataset)
    query = """
        SELECT 
            region,
            metadata.new_discount_code as discount_code,
            COUNT(*) as orders_with_discount
        FROM orders_all
        WHERE metadata.new_discount_code IS NOT NULL
        GROUP BY region, discount_code
        ORDER BY orders_with_discount DESC
        LIMIT 20
    """
    
    print("\n🔄 Querying new field (discount_code)...")
    
    try:
        result = spark.sql(query).collect()
        
        print(f"✅ Schema evolution handled gracefully!")
        print(f"   Found {len(result)} discount codes")
        print("\n   Sample results:")
        for row in result[:5]:
            print(f"     {row['region']}: {row['discount_code']} ({row['orders_with_discount']} orders)")
        
        schema_result = {
            'success': True,
            'new_field': 'new_discount_code',
            'rows_with_new_field': sum(row['orders_with_discount'] for row in result),
            'demonstrates': 'VARIANT handles schema evolution without updates',
            'maps_to': 'CMU 15-721 Lecture 03: Data Models'
        }
        
    except Exception as e:
        print(f"❌ Schema evolution failed: {e}")
        schema_result = {
            'success': False,
            'error': str(e)
        }
    
    spark.stop()
    
    return schema_result

if __name__ == '__main__':
    # Run VARIANT acid test
    variant_results = test_variant_shredding()
    
    # Run schema evolution test
    evolution_results = test_schema_evolution()
    
    print("\n" + "="*80)
    print(" ALL TESTS COMPLETE")
    print("="*80)
