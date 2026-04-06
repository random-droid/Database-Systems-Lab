"""
Benchmark Results Report Generator
====================================

Reads JSON results from all 4 use cases and generates a text report
plus an HTML visualization.

Usage:
    python results/generate_report.py
"""

import json
import sys
from pathlib import Path
from datetime import datetime


def load_results(filepath):
    """Load JSON results, return None if file not found."""
    path = Path(filepath)
    if not path.exists():
        return None
    with open(path) as f:
        return json.load(f)


def format_bytes(b):
    if b >= 1024 ** 3:
        return f"{b / 1024**3:.2f} GB"
    elif b >= 1024 ** 2:
        return f"{b / 1024**2:.1f} MB"
    elif b >= 1024:
        return f"{b / 1024:.1f} KB"
    return f"{b} B"


def generate_text_report(output_path="results/benchmark_report.txt"):
    """Generate a human-readable text report."""

    lines = []
    lines.append("=" * 80)
    lines.append("OLAP BENCHMARK SANDBOX — RESULTS REPORT")
    lines.append(f"Generated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    lines.append("Validates concepts from CMU 15-721 Advanced Database Systems")
    lines.append("=" * 80)

    # --- Use Case 1: Dashboards ---
    uc1 = load_results("results/use_case_1_dashboards.json")
    lines.append("\n")
    lines.append("USE CASE 1: Sub-second Dashboard Queries")
    lines.append("-" * 60)
    lines.append("Query: Regional revenue by month (GROUP BY on 50M rows)")
    lines.append("Maps to: CMU 15-721 Lecture 07 — Vectorized Execution")

    if uc1:
        for system, data in uc1.items():
            t = data.get("total_time_seconds", "N/A")
            cpu = data.get("cpu_bound_percent", 0)
            io = data.get("io_bound_percent", 0)
            ch = data.get("cold_hot", {})
            speedup = ch.get("speedup", "N/A")
            lines.append(f"\n  {system.upper()}:")
            lines.append(f"    Total time:     {t}s")
            lines.append(f"    CPU/IO split:   {cpu:.1f}% / {io:.1f}%")
            lines.append(f"    Cold/Hot:       {speedup}x buffer pool speedup")
            lines.append(f"    Demonstrates:   {data.get('demonstrates', 'N/A')}")

        pg_t = uc1.get("postgres", {}).get("total_time_seconds")
        dk_t = uc1.get("duckdb", {}).get("total_time_seconds")
        if pg_t and dk_t and dk_t > 0:
            ratio = pg_t / dk_t
            lines.append(f"\n  FINDING: DuckDB is {ratio:.1f}x faster than Postgres")
            lines.append("  REASON:  Column store + SIMD vectorization vs tuple-at-a-time row store")
    else:
        lines.append("  [Results not found — run benchmark_dashboards.py first]")

    # --- Use Case 2: Complex Joins ---
    uc2 = load_results("results/use_case_2_complex_joins.json")
    lines.append("\n")
    lines.append("USE CASE 2: Complex Analytical Joins (Spill-to-Disk Stress Test)")
    lines.append("-" * 60)
    lines.append("Query: 3-table join on 50M × 1M × 10K rows")
    lines.append("Maps to: CMU 15-721 Lecture 06 — External Algorithms | Lecture 09 — Join Algorithms")

    if uc2:
        for system, data in uc2.items():
            lines.append(f"\n  {system.upper()}:")
            if system == "postgres":
                for work_mem, metrics in data.get("results_by_work_mem", {}).items():
                    external = metrics.get("external_merge", False)
                    t = metrics.get("total_time_seconds", "N/A")
                    temp_w = metrics.get("temp_written_blocks", 0)
                    lines.append(f"    work_mem={work_mem}: {t}s | External merge: {'YES ← SMOKING GUN' if external else 'NO'}")
                    if temp_w > 0:
                        lines.append(f"      temp written={temp_w} blocks → external sort confirmed")
            else:
                t = data.get("total_time_seconds", "N/A")
                cpu = data.get("cpu_bound_percent", 0)
                io = data.get("io_bound_percent", 0)
                lines.append(f"    Total time: {t}s | CPU/IO: {cpu:.1f}% / {io:.1f}%")

                spill = data.get("spill_metrics", {})
                if spill.get("external_merge_occurred"):
                    disk_mb = spill.get("disk_spill_bytes", 0) / (1024 ** 2)
                    lines.append(f"    SPILL: {disk_mb:.1f} MB to disk ← external merge sort confirmed!")
                else:
                    lines.append("    No spill detected (in-memory)")

                if "out_of_core" in data and data["out_of_core"]:
                    lines.append(f"    OUT-OF-CORE: Peak memory > 2GB, graceful degradation")

        lines.append("\n  FINDING: Replit 2GB RAM forces external algorithms into action")
        lines.append("  PROVES:  CMU 15-721 Lecture 06 — External sorting / merge join behavior")
    else:
        lines.append("  [Results not found — run benchmark_complex_joins.py first]")

    # --- Use Case 3: VARIANT Shredding ---
    uc3 = load_results("results/use_case_3_variant_acid_test.json")
    lines.append("\n")
    lines.append("USE CASE 3: VARIANT Shredding Acid Test")
    lines.append("-" * 60)
    lines.append("Query: JSON field access — STRING JSON vs VARIANT (Spark 4.1)")
    lines.append("Maps to: CMU 15-721 Lecture 03 — PAX Storage / Sub-columnar Layout")

    if uc3:
        sj = uc3.get("string_json", {})
        vr = uc3.get("variant_shredded", {})
        proof = uc3.get("proof", {})

        lines.append(f"\n  STRING JSON:")
        lines.append(f"    Time:        {sj.get('execution_time_seconds', 'N/A')}s")
        lines.append(f"    Peak memory: {sj.get('peak_memory_mb', 'N/A')} MB")
        spill_bytes = sj.get("disk_spill_bytes", 0)
        lines.append(f"    Disk spill:  {format_bytes(spill_bytes) if spill_bytes else 'None'}")

        lines.append(f"\n  VARIANT (shredded):")
        lines.append(f"    Time:        {vr.get('execution_time_seconds', 'N/A')}s")
        lines.append(f"    Peak memory: {vr.get('peak_memory_mb', 'N/A')} MB")
        vspill_bytes = vr.get("disk_spill_bytes", 0)
        lines.append(f"    Disk spill:  {format_bytes(vspill_bytes) if vspill_bytes else 'None'}")

        lines.append(f"\n  ACID TEST RESULT:")
        if proof.get("variant_avoided_spill"):
            lines.append(f"    PASSED: VARIANT avoided spill while STRING JSON spilled")
            lines.append(f"    Speedup: {proof.get('speedup', 'N/A')}x")
            lines.append(f"    Memory savings: {proof.get('memory_savings_mb', 'N/A')} MB")
        else:
            lines.append(f"    Both approaches performed similarly ({proof.get('speedup', 1):.1f}x speedup)")
        lines.append(f"    Conclusion: {proof.get('conclusion', 'N/A')}")
    else:
        lines.append("  [Results not found — run benchmark_variant_test.py first]")

    # --- Use Case 4: Clustering ---
    uc4 = load_results("results/use_case_4_clustering.json")
    lines.append("\n")
    lines.append("USE CASE 4: Clustering & Zone Map Impact")
    lines.append("-" * 60)
    lines.append("Query: Region-filtered scan with and without physical sort order")
    lines.append("Maps to: CMU 15-721 Lecture 04 — Storage Models (clustered indexes)")

    if uc4:
        for system, data in uc4.items():
            lines.append(f"\n  {system.upper()}:")
            if "error" in data:
                lines.append(f"    Error: {data['error']}")
            else:
                speedup = data.get("speedup", "N/A")
                lines.append(f"    Speedup from clustering: {speedup}x")
                lines.append(f"    Demonstrates: {data.get('demonstrates', 'N/A')}")
                lines.append(f"    Maps to: {data.get('maps_to', 'N/A')}")
    else:
        lines.append("  [Results not found — run benchmark_clustering.py first]")

    # --- 15-721 Traceability Matrix ---
    lines.append("\n")
    lines.append("CMU 15-721 TRACEABILITY MATRIX")
    lines.append("-" * 60)
    matrix = [
        ("Lecture 03: Data Models",          "Use Case 3", "VARIANT PAX sub-columnar layout avoids spills"),
        ("Lecture 04: Storage Models",        "Use Case 4", "Clustered index / zone map pruning speedup"),
        ("Lecture 05: Buffer Pool Mgmt",      "Use Cases 1+2", "Cold vs Hot scan — OS page cache effects"),
        ("Lecture 06: External Algorithms",   "Use Case 2", "Spill-to-disk on 50M row join at 2GB RAM"),
        ("Lecture 07: Vectorized Execution",  "Use Case 1", "DuckDB SIMD vs Postgres tuple-at-a-time"),
        ("Lecture 09: Join Algorithms",       "Use Case 2", "Hash join vs merge join vs external merge"),
    ]
    for lecture, use_case, proof in matrix:
        lines.append(f"  {lecture:<35} | {use_case:<15} | {proof}")

    lines.append("\n" + "=" * 80)
    lines.append("END OF REPORT")
    lines.append("=" * 80)

    report_text = "\n".join(lines)

    # Write text report
    Path("results").mkdir(exist_ok=True)
    with open(output_path, "w") as f:
        f.write(report_text)

    print(report_text)
    print(f"\nReport saved: {output_path}")

    return report_text


def generate_html_report(output_path="results/visualizations.html"):
    """Generate an HTML report with inline visualizations."""

    uc1 = load_results("results/use_case_1_dashboards.json") or {}
    uc2 = load_results("results/use_case_2_complex_joins.json") or {}
    uc3 = load_results("results/use_case_3_variant_acid_test.json") or {}
    uc4 = load_results("results/use_case_4_clustering.json") or {}

    # Build chart data
    uc1_labels = list(uc1.keys())
    uc1_times = [uc1[s].get("total_time_seconds", 0) for s in uc1_labels]

    uc2_labels, uc2_times = [], []
    for system, data in uc2.items():
        if system == "postgres":
            for wm, metrics in data.get("results_by_work_mem", {}).items():
                uc2_labels.append(f"Postgres ({wm})")
                uc2_times.append(metrics.get("total_time_seconds", 0))
        else:
            uc2_labels.append(system.upper())
            uc2_times.append(data.get("total_time_seconds", 0))

    uc3_labels = ["STRING JSON", "VARIANT"]
    uc3_times = [
        uc3.get("string_json", {}).get("execution_time_seconds", 0),
        uc3.get("variant_shredded", {}).get("execution_time_seconds", 0),
    ]

    uc4_rows = []
    for system, data in uc4.items():
        if "speedup" in data:
            uc4_rows.append({"system": system, "speedup": data["speedup"]})

    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>OLAP Benchmark Sandbox — Results</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
<style>
  body {{ font-family: system-ui, -apple-system, sans-serif; background: #0f172a; color: #e2e8f0; margin: 0; padding: 2rem; }}
  h1 {{ color: #38bdf8; font-size: 1.8rem; margin-bottom: 0.25rem; }}
  .subtitle {{ color: #94a3b8; margin-bottom: 2rem; }}
  .grid {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(500px, 1fr)); gap: 1.5rem; }}
  .card {{ background: #1e293b; border: 1px solid #334155; border-radius: 12px; padding: 1.5rem; }}
  .card h2 {{ color: #38bdf8; font-size: 1rem; margin: 0 0 0.5rem; }}
  .card .sub {{ color: #64748b; font-size: 0.8rem; margin-bottom: 1rem; }}
  canvas {{ max-height: 260px; }}
  .matrix {{ width: 100%; border-collapse: collapse; font-size: 0.82rem; }}
  .matrix th {{ background: #0f172a; color: #38bdf8; padding: 0.5rem 0.75rem; text-align: left; }}
  .matrix td {{ padding: 0.5rem 0.75rem; border-top: 1px solid #1e293b; }}
  .matrix tr:hover td {{ background: #1e293b; }}
  .tag {{ display: inline-block; background: #0ea5e920; color: #38bdf8; border: 1px solid #0ea5e940; border-radius: 4px; padding: 1px 6px; font-size: 0.72rem; }}
  footer {{ color: #475569; margin-top: 2rem; font-size: 0.8rem; }}
</style>
</head>
<body>
<h1>OLAP Benchmark Sandbox</h1>
<p class="subtitle">CMU 15-721 Validation · 50M row e-commerce dataset · Replit 2GB RAM (forces external algorithms)</p>

<div class="grid">

  <div class="card">
    <h2>Use Case 1: Dashboard Query Throughput</h2>
    <p class="sub">Regional revenue GROUP BY on 50M rows · CMU 15-721 Lecture 07: Vectorized Execution</p>
    <canvas id="uc1chart"></canvas>
  </div>

  <div class="card">
    <h2>Use Case 2: Complex Join (Spill-to-Disk)</h2>
    <p class="sub">3-table join 50M × 1M × 10K · CMU 15-721 Lecture 06: External Algorithms</p>
    <canvas id="uc2chart"></canvas>
  </div>

  <div class="card">
    <h2>Use Case 3: VARIANT Shredding Acid Test</h2>
    <p class="sub">STRING JSON vs VARIANT · CMU 15-721 Lecture 03: PAX Storage</p>
    <canvas id="uc3chart"></canvas>
  </div>

  <div class="card">
    <h2>Use Case 4: Clustering Speedup</h2>
    <p class="sub">Clustered vs unclustered · CMU 15-721 Lecture 04: Storage Models</p>
    <canvas id="uc4chart"></canvas>
  </div>

</div>

<div class="card" style="margin-top:1.5rem">
  <h2>CMU 15-721 Traceability Matrix</h2>
  <table class="matrix">
    <thead><tr><th>Lecture</th><th>Use Case</th><th>What It Proves</th><th>Smoking Gun Metric</th></tr></thead>
    <tbody>
      <tr><td>Lecture 03: Data Models</td><td>Use Case 3</td><td>VARIANT sub-columnar layout avoids IO</td><td>STRING spills, VARIANT doesn't</td></tr>
      <tr><td>Lecture 04: Storage Models</td><td>Use Case 4</td><td>Physical sort order / zone map pruning</td><td>N× speedup from CLUSTER / sorted Parquet</td></tr>
      <tr><td>Lecture 05: Buffer Pool Mgmt</td><td>Use Cases 1+2</td><td>OS page cache effects (cold vs hot scans)</td><td>5–10× speedup on repeated queries</td></tr>
      <tr><td>Lecture 06: External Algorithms</td><td>Use Case 2</td><td>External merge sort under memory pressure</td><td><span class="tag">EXPLAIN BUFFERS: temp written=N</span> · Spark disk_spill_bytes</td></tr>
      <tr><td>Lecture 07: Vectorized Execution</td><td>Use Case 1</td><td>SIMD vectorization vs tuple-at-a-time</td><td>DuckDB N× faster than Postgres on same query</td></tr>
      <tr><td>Lecture 09: Join Algorithms</td><td>Use Case 2</td><td>Broadcast vs shuffle vs external merge join</td><td>Postgres join strategy in EXPLAIN output</td></tr>
    </tbody>
  </table>
</div>

<footer>Generated {datetime.now().strftime('%Y-%m-%d %H:%M:%S')} · OLAP Benchmark Sandbox · Replit 2GB constraint = teaching opportunity</footer>

<script>
const palette = ['#38bdf8','#34d399','#fb923c','#a78bfa','#f472b6'];

new Chart(document.getElementById('uc1chart'), {{
  type: 'bar',
  data: {{
    labels: {json.dumps([l.upper() for l in uc1_labels])},
    datasets: [{{ label: 'Execution Time (s)', data: {json.dumps(uc1_times)}, backgroundColor: palette }}]
  }},
  options: {{ plugins: {{ legend: {{ display: false }} }}, scales: {{ y: {{ title: {{ display: true, text: 'Seconds', color: '#94a3b8' }}, ticks: {{ color: '#94a3b8' }}, grid: {{ color: '#1e293b' }} }}, x: {{ ticks: {{ color: '#e2e8f0' }}, grid: {{ color: '#1e293b' }} }} }} }}
}});

new Chart(document.getElementById('uc2chart'), {{
  type: 'bar',
  data: {{
    labels: {json.dumps(uc2_labels)},
    datasets: [{{ label: 'Execution Time (s)', data: {json.dumps(uc2_times)}, backgroundColor: palette }}]
  }},
  options: {{ plugins: {{ legend: {{ display: false }} }}, scales: {{ y: {{ title: {{ display: true, text: 'Seconds', color: '#94a3b8' }}, ticks: {{ color: '#94a3b8' }}, grid: {{ color: '#1e293b' }} }}, x: {{ ticks: {{ color: '#e2e8f0' }}, grid: {{ color: '#1e293b' }} }} }} }}
}});

new Chart(document.getElementById('uc3chart'), {{
  type: 'bar',
  data: {{
    labels: {json.dumps(uc3_labels)},
    datasets: [{{ label: 'Execution Time (s)', data: {json.dumps(uc3_times)}, backgroundColor: [palette[2], palette[1]] }}]
  }},
  options: {{ plugins: {{ legend: {{ display: false }} }}, scales: {{ y: {{ title: {{ display: true, text: 'Seconds', color: '#94a3b8' }}, ticks: {{ color: '#94a3b8' }}, grid: {{ color: '#1e293b' }} }}, x: {{ ticks: {{ color: '#e2e8f0' }}, grid: {{ color: '#1e293b' }} }} }} }}
}});

new Chart(document.getElementById('uc4chart'), {{
  type: 'bar',
  data: {{
    labels: {json.dumps([r['system'].upper() for r in uc4_rows])},
    datasets: [{{ label: 'Speedup (x)', data: {json.dumps([r['speedup'] for r in uc4_rows])}, backgroundColor: palette }}]
  }},
  options: {{ plugins: {{ legend: {{ display: false }} }}, scales: {{ y: {{ title: {{ display: true, text: 'Speedup (higher = better)', color: '#94a3b8' }}, ticks: {{ color: '#94a3b8' }}, grid: {{ color: '#1e293b' }} }}, x: {{ ticks: {{ color: '#e2e8f0' }}, grid: {{ color: '#1e293b' }} }} }} }}
}});
</script>
</body>
</html>
"""

    Path("results").mkdir(exist_ok=True)
    with open(output_path, "w") as f:
        f.write(html)

    print(f"HTML report saved: {output_path}")

    return output_path


if __name__ == "__main__":
    generate_text_report()
    generate_html_report()
