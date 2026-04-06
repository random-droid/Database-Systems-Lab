# Workspace

## Overview

OLAP Benchmark Sandbox — a research-grade benchmarking system that compares Postgres, DuckDB, and Spark on a 50M-row e-commerce dataset. Results are mapped to CMU 15-721 Advanced Database Systems concepts via an inline annotation layer (ConceptValidator).

pnpm workspace monorepo using TypeScript + Python.

## Architecture

### Python Benchmark Layer (`olap-benchmark/`)
- `data_generator.py` — generates 50M-row Parquet dataset
- `loaders/load_all_systems.py` — loads data into Postgres, DuckDB, Spark
- `benchmarks/benchmark_dashboards.py` — Use Case 1: dashboard queries
- `benchmarks/benchmark_complex_joins.py` — Use Case 2: 3-table join stress test
- `benchmarks/benchmark_variant_test.py` — Use Case 3: VARIANT shredding acid test
- `benchmarks/benchmark_clustering.py` — Use Case 4: clustering & zone map test
- `utils/concept_validator.py` — maps metrics → CMU 15-721 concept annotations
- `results/` — benchmark JSON output files (read by the API)

### Express API Server (`artifacts/api-server/`)
- `GET /api/benchmarks/status` — running state + available systems
- `GET /api/benchmarks/results/:useCase` — reads results JSON from `olap-benchmark/results/`
- `POST /api/benchmarks/run/:useCase` — spawns Python benchmark as child process
- `GET /api/benchmarks/logs/:useCase` — SSE stream of live Python stdout

### React Dashboard (`artifacts/dashboard/`)
- Split-panel result cards: left=metrics chart, right=ConceptValidator annotation
- Annotation panel: purple lecture badge, red smoking-gun box, blue interpretation, ✅/⚠️ status chip
- SSE log streaming via `EventSource`
- CMU 15-721 traceability matrix at bottom

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Validation**: Zod, Orval (OpenAPI codegen)
- **Frontend**: React + Vite + Tailwind + Recharts
- **Python**: psycopg2, duckdb, pyspark, psutil

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas
- `pnpm --filter @workspace/api-server run dev` — run API server locally

### Running benchmarks (from `olap-benchmark/` directory):
```bash
python3 benchmarks/benchmark_dashboards.py
python3 benchmarks/benchmark_complex_joins.py
python3 benchmarks/benchmark_variant_test.py
python3 benchmarks/benchmark_clustering.py
```

## Result File Locations
- `olap-benchmark/results/use_case_1_dashboards.json`
- `olap-benchmark/results/use_case_2_complex_joins.json`
- `olap-benchmark/results/use_case_3_variant_acid_test.json`
- `olap-benchmark/results/use_case_4_clustering.json`

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
