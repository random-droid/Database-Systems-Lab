"""
Run All Benchmarks
==================

Orchestrates all 4 use cases in sequence and generates a final report.

Usage:
    python -m benchmarks.run_all
    python benchmarks/run_all.py

Estimated runtime: 15-30 minutes (Spark is slowest)

Maps to CMU 15-721 Lectures 03, 04, 05, 06, 07, 09
"""

import sys
import json
import time
from pathlib import Path
from datetime import datetime

sys.path.append(str(Path(__file__).parent.parent))


def run_use_case(name, module_path, runner_func):
    """Run a single use case with timing and error handling."""
    print(f"\n{'='*80}")
    print(f" STARTING: {name}")
    print(f"{'='*80}")

    start = time.time()
    try:
        import importlib
        module = importlib.import_module(module_path)
        result = getattr(module, runner_func)()
        elapsed = time.time() - start
        print(f"\n COMPLETED: {name} in {elapsed:.1f}s")
        return {"status": "success", "elapsed_seconds": round(elapsed, 1), "data": result}
    except Exception as e:
        elapsed = time.time() - start
        print(f"\n FAILED: {name} after {elapsed:.1f}s — {e}")
        return {"status": "failed", "elapsed_seconds": round(elapsed, 1), "error": str(e)}


def main():
    """Run all use cases and generate summary."""

    print("\n" + "=" * 80)
    print(" OLAP BENCHMARK SANDBOX — FULL RUN")
    print(f" Started: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(" Systems: Postgres | DuckDB | Spark")
    print(" Maps to: CMU 15-721 Advanced Database Systems")
    print("=" * 80)

    overall_start = time.time()

    suite_results = {}

    # Use Case 1: Sub-second Dashboards
    suite_results["use_case_1_dashboards"] = run_use_case(
        "Use Case 1: Sub-second Dashboard Queries",
        "benchmarks.benchmark_dashboards",
        "run_all_systems",
    )

    # Use Case 2: Complex Analytical Joins (the spill-to-disk stress test)
    suite_results["use_case_2_complex_joins"] = run_use_case(
        "Use Case 2: Complex Analytical Joins (Spill-to-Disk Stress Test)",
        "benchmarks.benchmark_complex_joins",
        "run_all_systems",
    )

    # Use Case 3: Schema Evolution & VARIANT Shredding
    suite_results["use_case_3_variant"] = run_use_case(
        "Use Case 3: VARIANT Shredding Acid Test",
        "benchmarks.benchmark_variant_test",
        "test_variant_shredding",
    )

    # Use Case 4: Clustering Impact
    suite_results["use_case_4_clustering"] = run_use_case(
        "Use Case 4: Clustering & Zone Map Impact",
        "benchmarks.benchmark_clustering",
        "run_all_systems",
    )

    # Use Case 5: ACID Integrity & Concurrency Control
    suite_results["use_case_5_acid_integrity"] = run_use_case(
        "Use Case 5: ACID Integrity & Concurrency Control",
        "benchmarks.benchmark_acid_integrity",
        "run_acid_integrity_benchmark",
    )

    total_elapsed = time.time() - overall_start

    # Build summary
    summary = {
        "run_timestamp": datetime.now().isoformat(),
        "total_elapsed_seconds": round(total_elapsed, 1),
        "environment": {
            "constraint": "2GB RAM (Replit)",
            "teaching_value": "Forces external sorting algorithms (CMU 15-721 Lecture 06)",
        },
        "results": suite_results,
        "lecture_map": {
            "Lecture 03: Data Models": "Use Case 3 — VARIANT shredding (PAX storage)",
            "Lecture 04: Storage Models": "Use Case 4 — Clustering / zone maps",
            "Lecture 05: Buffer Pool Management": "Use Cases 1+2 — Cold vs Hot scans",
            "Lecture 06: External Algorithms": "Use Case 2 — Spill-to-disk on 50M row join",
            "Lecture 07: Vectorized Execution": "Use Case 1 — DuckDB vs Postgres throughput",
            "Lecture 09: Join Algorithms": "Use Case 2 — Broadcast vs shuffle vs merge join",
        },
    }

    # Save master results file
    output_dir = Path("results")
    output_dir.mkdir(exist_ok=True)

    master_file = output_dir / "benchmark_results.json"
    with open(master_file, "w") as f:
        json.dump(summary, f, indent=2)

    # Print final summary
    print("\n" + "=" * 80)
    print(" FULL BENCHMARK SUITE COMPLETE")
    print(f" Total time: {total_elapsed:.1f}s ({total_elapsed / 60:.1f} min)")
    print("=" * 80)

    statuses = {k: v["status"] for k, v in suite_results.items()}
    for uc, status in statuses.items():
        icon = "✅" if status == "success" else "❌"
        elapsed = suite_results[uc]["elapsed_seconds"]
        print(f"  {icon} {uc}: {status} ({elapsed}s)")

    print(f"\n Master results: {master_file}")
    print("\n Next step: python results/generate_report.py")

    return summary


if __name__ == "__main__":
    main()
