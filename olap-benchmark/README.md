# OLAP Benchmark Sandbox

A production-ready benchmark suite comparing 5 OLAP systems on a 50M row e-commerce dataset. Validates concepts from the CMU 15-721 Advanced Database Systems course.

**Key insight:** Replit's 2GB RAM constraint is a *feature* — it forces external sorting algorithms into action, demonstrating real-world behavior when systems hit memory limits.

## Systems Under Test

| System | Type | Demonstrates |
|--------|------|-------------|
| **Postgres** | Row-based OLTP | Tuple-at-a-time execution, work_mem tuning, external merge join |
| **DuckDB** | In-process OLAP | Vectorized execution, zero-copy Parquet, out-of-core processing |
| **PySpark** | Distributed (local) | Catalyst optimizer, VARIANT shredding, spill-to-disk metrics |
| **BigQuery** | Serverless cloud | Elastic memory (no spills) — *requires GCP credentials* |
| **Databricks** | Managed lakehouse | Photon engine — *requires Databricks credentials* |

## Setup

```bash
# Install Python dependencies
pip install -r requirements.txt
```

### Postgres
Replit automatically provisions Postgres. The benchmark will use:
- Database: `olap_benchmark` (auto-created)
- Connection: `localhost:5432`

### BigQuery / Databricks (optional, ~$18 total)
Add credentials to Replit Secrets panel — never put them in `.env`:
- `GCP_PROJECT_ID`, `GCP_CREDENTIALS` (full JSON key)
- `DATABRICKS_HOST`, `DATABRICKS_TOKEN`, `DATABRICKS_CLUSTER_ID`

## Running the Benchmarks

### Step 1: Generate Dataset
```bash
cd olap-benchmark
python data_generator.py
```
Generates ~500MB Parquet + temporary 5GB CSV (deleted after Postgres load).

### Step 2: Load All Systems
```bash
python -m loaders.load_all_systems
```
Storage strategy: Parquet shared by DuckDB/Spark, Postgres gets its own copy, CSV deleted immediately.

**Expected final storage: ~3.5GB total**

### Step 3: Run Individual Use Cases
```bash
# Use Case 1: Dashboard queries (vectorized execution proof)
python -m benchmarks.benchmark_dashboards

# Use Case 2: Complex joins (spill-to-disk stress test — the money benchmark)
python -m benchmarks.benchmark_complex_joins

# Use Case 3: VARIANT shredding acid test
python -m benchmarks.benchmark_variant_test

# Use Case 4: Clustering impact
python -m benchmarks.benchmark_clustering
```

### Step 4: Run Everything
```bash
python -m benchmarks.run_all
```

### Step 5: Generate Report
```bash
python results/generate_report.py
# Opens results/visualizations.html in browser
```

## Use Cases & CMU 15-721 Mapping

| Use Case | Query | Systems | CMU Lecture |
|----------|-------|---------|-------------|
| **Sub-second Dashboards** | Regional revenue by month | All 5 | Lecture 07: Vectorized Execution |
| **Complex Joins** | 3-table join (50M × 1M × 10K) | All 5 | Lecture 09: Join Algorithms |
| **Schema Evolution** | VARIANT vs STRING JSON | Spark, DuckDB | Lecture 03: Data Models |
| **Clustering Impact** | Clustered vs unclustered scans | DuckDB, Postgres | Lecture 04: Storage Models |

## What You'll Observe

On Replit's 2GB RAM:
- **Postgres** switches from hash join to **external merge join** (visible: `EXPLAIN BUFFERS: temp written=N`)
- **Spark** spills shuffle data to disk (visible: `disk_spill_bytes` in Spark UI at `localhost:4040`)
- **DuckDB** processes out-of-core (peak memory may exceed 2GB — no crash)
- **VARIANT** acid test: STRING JSON spills 1+ GB while VARIANT stays in-memory (3× speedup)
- **Cold vs Hot** scans: 5–10× speedup from OS page cache on second run

## Project Structure

```
olap-benchmark/
├── data_generator.py          # Generate 50M orders + 1M customers + 10K products
├── requirements.txt           # Python dependencies
├── .env.example               # Environment variable template
├── config/
│   └── spark_config.py        # Spark memory limits (1GB driver/executor)
├── data/
│   └── sample_data/           # Generated Parquet files land here
├── loaders/
│   └── load_all_systems.py    # Storage-aware loader (stays under 10GB)
├── benchmarks/
│   ├── benchmark_dashboards.py    # Use Case 1: dashboard queries
│   ├── benchmark_complex_joins.py # Use Case 2: spill-to-disk stress test
│   ├── benchmark_variant_test.py  # Use Case 3: VARIANT shredding acid test
│   ├── benchmark_clustering.py    # Use Case 4: clustering impact
│   └── run_all.py                 # Orchestrator — runs all 4 use cases
├── utils/
│   ├── benchmark_timer.py    # CPU vs IO breakdown + cold/hot scan timing
│   └── spark_metrics.py      # Safe Spark UI metrics capture (race-condition free)
└── results/
    ├── generate_report.py    # Text + HTML report generator
    ├── benchmark_results.json    # Master results (after run_all)
    ├── use_case_*.json           # Per-use-case results
    └── visualizations.html       # HTML report with Chart.js graphs
```

## Safety Checklist

Before running:
- [ ] Parquet generation completes (~500MB total)
- [ ] CSV deleted after Postgres load (frees ~5GB)
- [ ] Total storage verified under 9GB (`du -sh data/`)
- [ ] Spark UI enabled on `localhost:4040`
- [ ] Metrics captured BEFORE `spark.stop()`
- [ ] Budget limit enforced if using cloud systems ($20 max)

## Storage Budget

| Component | Size | Notes |
|-----------|------|-------|
| Parquet files | ~500MB | Shared by DuckDB + Spark |
| Postgres data | ~3GB | data + indexes |
| Orders CSV | 5GB → 0 | Temporary, deleted after Postgres load |
| **Total** | **~3.5GB** | Well under 10GB Replit limit |
