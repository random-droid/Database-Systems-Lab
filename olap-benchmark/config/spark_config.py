"""
Spark Configuration for Replit (2GB RAM Constraint)
====================================================

Memory limits force spill-to-disk, demonstrating external merge sort.
Maps to CMU 15-721 Lecture 06: External Algorithms
"""

# Spark session configuration for memory-constrained environment
SPARK_CONFIG = {
    # Memory limits (CRITICAL for Replit)
    "spark.driver.memory": "1g",           # Max 1GB driver
    "spark.executor.memory": "1g",         # Max 1GB executor
    
    # Reduce shuffle partitions (default 200 is wasteful on single node)
    "spark.sql.shuffle.partitions": "4",   # 4 partitions for local mode
    
    # Enable VARIANT shredding (Spark 4.1 feature)
    "spark.sql.variant.shredding.enabled": "true",
    
    # Optimize for local file access
    "spark.sql.files.maxPartitionBytes": "128MB",  # Avoid tiny partitions
    
    # Buffer pool optimizations
    "spark.sql.inMemoryColumnarStorage.compressed": "true",
    "spark.sql.inMemoryColumnarStorage.batchSize": "10000",
    
    # ENABLE UI for metrics capture (CRITICAL!)
    "spark.ui.enabled": "true",
    "spark.ui.port": "4040",
    
    # Adaptive Query Execution
    "spark.sql.adaptive.enabled": "true",
    "spark.sql.adaptive.coalescePartitions.enabled": "true",
    
    # Memory management
    "spark.memory.fraction": "0.6",        # 60% for execution/storage
    "spark.memory.storageFraction": "0.5",  # 50/50 split
}

# Local mode master (uses all cores)
SPARK_MASTER = "local[*]"

# Application name
SPARK_APP_NAME = "OLAP_Benchmark_Sandbox"

def get_spark_session():
    """
    Create configured Spark session for benchmarking.
    
    Returns SparkSession with memory constraints that will force spills.
    """
    from pyspark.sql import SparkSession
    
    builder = SparkSession.builder \
        .appName(SPARK_APP_NAME) \
        .master(SPARK_MASTER)
    
    # Apply all config
    for key, value in SPARK_CONFIG.items():
        builder = builder.config(key, str(value))
    
    spark = builder.getOrCreate()
    
    # Verify config
    print("⚡ Spark session created")
    print(f"   Driver memory: {spark.conf.get('spark.driver.memory')}")
    print(f"   Executor memory: {spark.conf.get('spark.executor.memory')}")
    print(f"   Shuffle partitions: {spark.conf.get('spark.sql.shuffle.partitions')}")
    print(f"   UI enabled: {spark.conf.get('spark.ui.enabled')}")
    print(f"   UI port: {spark.conf.get('spark.ui.port')}")
    
    return spark

if __name__ == '__main__':
    # Test configuration
    spark = get_spark_session()
    print("\n✅ Spark configuration validated")
    spark.stop()
