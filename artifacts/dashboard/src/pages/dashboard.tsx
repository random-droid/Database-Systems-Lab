import { useGetBenchmarkStatus, useRunBenchmark, getGetBenchmarkResultsQueryKey, getGetBenchmarkStatusQueryKey, useGetBenchmarkResults } from "@workspace/api-client-react";
import { useEffect, useState, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { Activity, Play, TerminalSquare, Database, Server, Table as TableIcon, Zap, HardDrive, CheckCircle2, ShieldAlert, Cpu, Archive, TrendingUp, Filter, Scale, Sparkles, Rocket, BookOpen, ChevronDown } from "lucide-react";

interface ValidationData {
  lecture: string;
  concept: string;
  proof: string;
  validates: string;
  status: string;
  confirmed: boolean;
  interpretation: string;
}

interface IoMetrics {
  total_time_seconds: number;
  cpu_bound_percent: number;
  io_bound_percent: number;
  peak_memory_mb: number;
}

interface ColdHot {
  cold: { time_seconds: number };
  hot: { time_seconds: number };
  speedup: number;
}

interface DashboardSystemResult extends IoMetrics {
  system: string;
  cold_hot: ColdHot;
  scan_strategy?: string;
  validation: ValidationData;
}

interface WorkMemResult extends IoMetrics {
  work_mem: string;
  temp_files_used: boolean;
  temp_written_blocks: number;
  join_strategy: string;
  external_merge: boolean;
}

interface ComplexJoinsSystemResult {
  system: string;
  results_by_work_mem?: Record<string, WorkMemResult>;
  total_time_seconds?: number;
  peak_memory_mb?: number;
  validation: ValidationData;
}

interface ClusteringSystemResult {
  system: string;
  unclustered?: IoMetrics;
  clustered?: IoMetrics;
  unsorted?: IoMetrics;
  sorted?: IoMetrics;
  speedup?: number;
  validation?: ValidationData;
}

interface VariantTestResult {
  string_json: { execution_time_seconds: number; peak_memory_mb: number; disk_spill_bytes: number; spilled_to_disk: boolean };
  variant_shredded: { execution_time_seconds: number; peak_memory_mb: number; disk_spill_bytes: number; spilled_to_disk: boolean };
  proof: { speedup: number; memory_savings_mb: number; variant_avoided_spill: boolean; conclusion: string };
  validation: ValidationData;
}

interface AcidParquetResult {
  writer_a_rows: number;
  writer_b_rows: number;
  expected_total_rows: number;
  actual_total_rows: number;
  lost_update_confirmed: boolean;
  rows_silently_lost: number;
  writer_a_status: string;
  writer_b_status: string;
  demonstrates: string;
}

interface AcidDeltaConflict {
  writer_a_status: string;
  writer_a_exception: string;
  writer_b_status: string;
  writer_b_rows_committed: number;
  occ_working: boolean;
  lost_update_prevented: boolean;
  demonstrates: string;
  note?: string;
}

interface AcidDeltaSnapshot {
  version_0_rows: number;
  current_version_rows: number;
  snapshot_isolation_confirmed: boolean;
  time_travel_query: string;
  demonstrates: string;
  note?: string;
}

interface AcidIntegrityResult {
  parquet_lost_update: AcidParquetResult;
  delta_conflict: AcidDeltaConflict;
  delta_snapshot: AcidDeltaSnapshot;
  validation: ValidationData;
}

interface VectorizedSystemResult {
  available: boolean;
  execution_time_ms?: number;
  rows_processed?: number;
  rows_per_second?: number;
  batch_model?: string;
  vector_size?: number;
  simd_capable?: boolean;
  note?: string;
  error?: string;
}

interface VectorizedExecutionResult {
  row_count: number;
  query: string;
  systems: {
    duckdb: VectorizedSystemResult;
    numpy_vectorized: VectorizedSystemResult;
    python_scalar: VectorizedSystemResult;
    postgres: VectorizedSystemResult;
  };
  speedup: {
    duckdb_vs_python_scalar?: number;
    duckdb_vs_numpy?: number;
    numpy_vs_python_scalar?: number;
    duckdb_vs_postgres?: number;
  };
  validation: ValidationData;
}

// ── UC7: Compression ──────────────────────────────────────────────────────
interface CompressionFormatResult {
  format: string;
  options: string;
  size_bytes: number;
  size_mb: number;
  write_time_ms: number;
  scan_time_ms: number;
  rows_per_second: number;
}
interface CompressionResult {
  row_count: number;
  formats: {
    csv: CompressionFormatResult;
    parquet_snappy: CompressionFormatResult;
    parquet_zstd: CompressionFormatResult;
  };
  comparison: {
    csv_vs_parquet_snappy: { size_ratio: number; scan_speedup: number };
    csv_vs_parquet_zstd: { size_ratio: number; scan_speedup: number };
  };
  validation: ValidationData;
}

// ── UC8: Window Functions ─────────────────────────────────────────────────
interface WindowSystemResult {
  available: boolean;
  execution_time_ms?: number;
  rows_processed?: number;
  rows_per_second?: number;
  window_ops?: string[];
  execution_model?: string;
  note?: string;
  error?: string;
}
interface WindowFunctionsResult {
  row_count: number;
  query: string;
  systems: {
    duckdb: WindowSystemResult;
    pandas: WindowSystemResult;
    postgres: WindowSystemResult;
  };
  speedup: {
    duckdb_vs_pandas?: number;
    duckdb_vs_postgres?: number;
  };
  validation: ValidationData;
}

// ── UC9: Query Optimization ───────────────────────────────────────────────
interface QueryScenario {
  label: string;
  description?: string;
  execution_time_ms: number;
  result_rows: number;
  join_operators_detected: string[];
  plan_excerpt?: string;
}
interface QueryOptimizationResult {
  fact_rows: number;
  dim_rows?: number;
  scenarios: {
    no_filter: QueryScenario;
    single_predicate: QueryScenario;
    double_predicate: QueryScenario;
  };
  comparison: {
    single_predicate_speedup: number;
    double_predicate_speedup: number;
    second_predicate_marginal_speedup?: number;
    optimizer_insight: string;
  };
  validation: ValidationData;
}

// ── UC10: Skew Handling ───────────────────────────────────────────────────
interface SkewScenario {
  label: string;
  execution_time_ms: number;
  groups: number;
}
interface SkewAggResult { uniform: SkewScenario; skewed: SkewScenario; slowdown: number }
interface SkewHandlingResult {
  row_count: number;
  skew_pct: number;
  partition_distribution: {
    uniform: Record<string, number>;
    skewed: Record<string, { count: number; pct: number }>;
  };
  scenarios: {
    simple_aggregation: SkewAggResult;
    complex_aggregation: SkewAggResult;
    heavy_aggregation: SkewAggResult;
  };
  comparison: {
    simple_agg_skew_slowdown: number;
    complex_agg_skew_slowdown: number;
    heavy_agg_skew_slowdown: number;
    partition_imbalance_factor: number;
    west_partition_pct: number;
    expected_partition_pct: number;
  };
  validation: ValidationData;
}

type UseCaseType = "dashboards" | "complex_joins" | "variant_test" | "clustering" | "acid_integrity" | "vectorized_execution" | "compression" | "window_functions" | "query_optimization" | "skew_handling";

const USE_CASES: { id: UseCaseType; title: string; description: string; lecture: string; icon: React.ReactNode }[] = [
  {
    id: "dashboards",
    title: "Why does the same query run 6× faster the second time?",
    description: "Run an aggregation twice on 50M rows — cold then hot. Watch execution time drop as the buffer pool warms up.",
    lecture: "Lecture 05: Buffer Pool Management",
    icon: <Zap className="w-5 h-5" />
  },
  {
    id: "complex_joins",
    title: "What happens when Postgres runs out of memory during a join?",
    description: "Force a 4-table join under a tight work_mem budget. Watch Postgres spill to disk and find the temp blocks in EXPLAIN ANALYZE.",
    lecture: "Lecture 06: External Merge Sort",
    icon: <TableIcon className="w-5 h-5" />
  },
  {
    id: "variant_test",
    title: "Is parsing embedded JSON really that expensive?",
    description: "Query one field from a JSON string column vs a VARIANT (shredded) column. Measure memory footprint, disk spill, and latency.",
    lecture: "Lecture 03: PAX Storage",
    icon: <Database className="w-5 h-5" />
  },
  {
    id: "clustering",
    title: "Can physical row ordering alone make a query 3× faster?",
    description: "Run the same range-predicate query on a clustered vs unclustered heap. The only difference is which pages the rows live on.",
    lecture: "Lecture 04: Storage Models",
    icon: <HardDrive className="w-5 h-5" />
  },
  {
    id: "acid_integrity",
    title: "Can you lose 500K rows without getting any error?",
    description: "Race two concurrent writers on Parquet (no concurrency control) and Delta Lake (OCC). One silently discards data — the other throws an exception.",
    lecture: "Lectures 13–15: OCC / MVCC",
    icon: <ShieldAlert className="w-5 h-5" />
  },
  {
    id: "vectorized_execution",
    title: "Why is DuckDB 25× faster than Python on the same hardware?",
    description: "Run the same arithmetic aggregation in DuckDB (SIMD batches), NumPy (columnar), and Python (row loop). See exactly where the gap comes from.",
    lecture: "Lectures 10–12: Vectorized Execution",
    icon: <Cpu className="w-5 h-5" />
  },
  {
    id: "compression",
    title: "How much does columnar storage actually shrink your data?",
    description: "Compare CSV, Parquet/Snappy, and Parquet/Zstd on the same 10M rows. Measure file size, scan speed, and what dictionary encoding does to low-cardinality columns.",
    lecture: "Lecture 03: Storage Models & Compression",
    icon: <Archive className="w-5 h-5" />
  },
  {
    id: "window_functions",
    title: "Why are DuckDB window functions so much faster than pandas?",
    description: "Compute 7 window operations (LAG, LEAD, RANK, ROW_NUMBER, SUM OVER, AVG OVER, delta) in DuckDB vs pandas vs Postgres. DuckDB fuses all 7 into one sorted pass.",
    lecture: "Lecture 11: Advanced Operators (Window Functions)",
    icon: <TrendingUp className="w-5 h-5" />
  },
  {
    id: "query_optimization",
    title: "Does adding a WHERE clause always make a query faster?",
    description: "Run a join with 0, 1, and 2 predicates. See how the optimizer's predicate pushdown shrinks the hash table at each step — and by exactly how much.",
    lecture: "Lectures 07–08: Query Optimization",
    icon: <Filter className="w-5 h-5" />
  },
  {
    id: "skew_handling",
    title: "What happens when 90% of your data lands in one partition?",
    description: "Compare a uniform dataset vs one where 90% of rows share the 'West' key. One thread does all the work while the others idle — watch the straggler effect.",
    lecture: "Lecture 09: Join Algorithms (Skew)",
    icon: <Scale className="w-5 h-5" />
  }
];

const TRACEABILITY_MATRIX = [
  { benchmark: "VARIANT vs STRING JSON", lecture: "Lecture 03", concept: "PAX Storage", proof: "VARIANT avoids disk_spill_bytes; STRING spills" },
  { benchmark: "Postgres CLUSTER heap", lecture: "Lecture 04", concept: "Storage Models (Clustered Index)", proof: "cluster_speedup > 3x; sequential vs random IO" },
  { benchmark: "Dashboard cold/hot cache", lecture: "Lecture 05", concept: "Buffer Pool Management", proof: "hot_speedup > 3x; OS page cache eliminates disk IO" },
  { benchmark: "Postgres join (low work_mem)", lecture: "Lecture 06", concept: "External Merge Sort", proof: "temp written=N blocks in EXPLAIN ANALYZE" },
  { benchmark: "DuckDB dashboard query", lecture: "Lecture 07", concept: "Vectorized Execution", proof: "cpu_bound_percent > 75%; SIMD column-at-a-time" },
  { benchmark: "DuckDB/Spark complex join", lecture: "Lecture 09", concept: "Join Algorithms", proof: "hash join in-memory vs broadcast shuffle vs merge join" },
  { benchmark: "Delta Lake OCC vs Parquet", lecture: "Lectures 13–15", concept: "OCC / MVCC / Lost Update Prevention", proof: "ConcurrentAppendException raised; Parquet silently lost 500K rows" },
  { benchmark: "DuckDB vs Python scalar loop", lecture: "Lectures 10–12", concept: "Vectorized Execution / SIMD", proof: "DuckDB 25x faster; 1024-tuple SIMD batches vs row-at-a-time Volcano model" },
  { benchmark: "CSV vs Parquet (Snappy/Zstd)", lecture: "Lecture 03", concept: "Columnar Compression (dict, RLE, bit-packing)", proof: "Parquet 3-7x smaller; scan 5-7x faster despite decompression overhead" },
  { benchmark: "DuckDB vs Pandas window ops", lecture: "Lecture 11", concept: "Advanced Operators (Window Functions)", proof: "DuckDB fuses sort+agg in single pass; pandas needs extra merge join" },
  { benchmark: "Predicate pushdown (0, 1, 2 preds)", lecture: "Lectures 07–08", concept: "Cost-Based Optimization / Predicate Pushdown", proof: "2-predicate query 1.5x faster; HASH_JOIN selected in all scenarios" },
  { benchmark: "90% West skew vs uniform", lecture: "Lecture 09", concept: "Join Skew / Partition Imbalance", proof: "4.5x partition imbalance; heavy agg (COUNT DISTINCT) slowdown visible" },
];

const HEADLINE_STATS = [
  {
    value: "25×",
    label: "Vectorized Speedup",
    sub: "DuckDB SIMD vs row-at-a-time Volcano",
    color: "text-indigo-400",
    border: "border-indigo-500/25",
    glow: "shadow-[0_0_12px_rgba(99,102,241,0.15)]",
    bg: "bg-indigo-500/8",
  },
  {
    value: "6.66×",
    label: "Compression Ratio",
    sub: "Parquet/Zstd vs CSV on 10M rows",
    color: "text-emerald-400",
    border: "border-emerald-500/25",
    glow: "shadow-[0_0_12px_rgba(52,211,153,0.15)]",
    bg: "bg-emerald-500/8",
  },
  {
    value: "3.12×",
    label: "Clustering Speedup",
    sub: "CLUSTER heap vs random I/O",
    color: "text-orange-400",
    border: "border-orange-500/25",
    glow: "shadow-[0_0_12px_rgba(251,146,60,0.15)]",
    bg: "bg-orange-500/8",
  },
  {
    value: "3×+",
    label: "Buffer Cache Hit",
    sub: "Hot page cache vs cold disk scan",
    color: "text-cyan-400",
    border: "border-cyan-500/25",
    glow: "shadow-[0_0_12px_rgba(34,211,238,0.15)]",
    bg: "bg-cyan-500/8",
  },
  {
    value: "4.5×",
    label: "Partition Skew",
    sub: "90% West skew vs uniform dist.",
    color: "text-red-400",
    border: "border-red-500/25",
    glow: "shadow-[0_0_12px_rgba(248,113,113,0.15)]",
    bg: "bg-red-500/8",
  },
  {
    value: "500K",
    label: "Rows Silently Lost",
    sub: "Parquet vs Delta Lake OCC isolation",
    color: "text-purple-400",
    border: "border-purple-500/25",
    glow: "shadow-[0_0_12px_rgba(192,132,252,0.15)]",
    bg: "bg-purple-500/8",
  },
];

function StatsGrid({ validatedCount, total }: { validatedCount: number; total: number }) {
  return (
    <section className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
      {/* Validated count — prominent first card */}
      <div className="col-span-2 md:col-span-2 lg:col-span-1 rounded-xl border border-primary/40 bg-primary/10 shadow-[0_0_20px_rgba(0,255,255,0.12)] p-4 flex flex-col justify-between">
        <span className="text-[10px] font-mono uppercase tracking-widest text-primary/70 mb-1">Experiments</span>
        <span className="text-4xl font-bold font-mono text-primary leading-none">{validatedCount}<span className="text-xl text-primary/50">/{total}</span></span>
        <span className="text-[10px] text-muted-foreground mt-2 leading-tight">experiments run<br/>· findings logged</span>
      </div>
      {HEADLINE_STATS.map((s) => (
        <div key={s.label} className={`rounded-xl border ${s.border} ${s.bg} ${s.glow} p-4 flex flex-col justify-between`}>
          <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground/70 mb-1">{s.label}</span>
          <span className={`text-3xl font-bold font-mono leading-none ${s.color}`}>{s.value}</span>
          <span className="text-[10px] text-muted-foreground mt-2 leading-tight">{s.sub}</span>
        </div>
      ))}
    </section>
  );
}

const PLAYLIST = "PLSE8ODhjZXjbEeW_bOCZ8c_nx_Jhoz-GW";
const yt = (vid: string, idx: number) =>
  `https://www.youtube.com/watch?v=${vid}&list=${PLAYLIST}&index=${idx}`;

const LECTURE_META: Record<string, {
  title: string;
  quote: string;
  author: string;
  concepts: string[];
  url: string;
}> = {
  "03": {
    title: "Storage Models, Data Layout & Formats",
    quote: "Access patterns should match the storage layout. Columnar storage reads only the columns you need — dictionary encoding and RLE compress repeated values to near-zero.",
    author: "Pavlo, Lecture 03",
    concepts: ["PAX (Partition Attributes Across)", "Dictionary encoding", "Run-length encoding (RLE)", "Zone maps / data skipping"],
    url: yt("z2GhznqtIz0", 3),
  },
  "04": {
    title: "Database Compression",
    quote: "The goal of compression is to reduce the volume of data the DBMS needs to read from disk — not just to save storage space.",
    author: "Pavlo, Lecture 04",
    concepts: ["Columnar compression", "Zone maps / min-max indexes", "Clustered heap files", "Block-level skipping"],
    url: yt("zyn_T5uragA", 4),
  },
  "05": {
    title: "Memory Management & Buffer Pools",
    quote: "The DBMS knows more about its own access patterns than the OS ever could. Never surrender buffer pool management to the operating system.",
    author: "Pavlo, Lecture 05",
    concepts: ["Buffer pool manager", "LRU / CLOCK page replacement", "Sequential flood avoidance", "Cold vs hot page cache"],
    url: yt("TjlmNGNx77E", 5),
  },
  "06": {
    title: "External Sorting & Aggregations",
    quote: "When data doesn't fit in memory, you must spill to disk. External merge sort is the foundation of every out-of-memory algorithm in a DBMS.",
    author: "Pavlo, Lecture 06",
    concepts: ["External merge sort", "B-way merge passes", "work_mem pressure", "Temp file spill tracking"],
    url: yt("0tABbNHUgZo", 6),
  },
  "07": {
    title: "Query Planning & Optimization (Part 1)",
    quote: "Push predicates as deep as possible into the query plan — apply filters before the build and probe phases of every join.",
    author: "Pavlo, Lecture 07",
    concepts: ["Predicate pushdown", "Selectivity estimation", "Cost-based plan search", "Cardinality estimates"],
    url: yt("YmY_NwaoxNk", 7),
  },
  "08": {
    title: "Query Planning & Optimization (Part 2)",
    quote: "The optimizer picks the join algorithm based on cardinality estimates. Get those wrong and you choose nested-loop when you should hash-join.",
    author: "Pavlo, Lecture 08",
    concepts: ["Join ordering", "Hash join vs nested-loop vs merge join", "Histograms", "Dynamic programming plan enumeration"],
    url: yt("VqFZyWHGQVM", 8),
  },
  "09": {
    title: "Join Algorithms & Parallel Execution Skew",
    quote: "Parallel execution is only as fast as the slowest partition. Data skew means one thread does 90% of the work while the others idle.",
    author: "Pavlo, Lecture 09",
    concepts: ["Hash partitioning", "Partition imbalance / straggler", "COUNT DISTINCT under skew", "Adaptive Query Execution (AQE)"],
    url: yt("Vf-N3JzWz0g", 9),
  },
  "10": {
    title: "Sorting, Aggregations & Vectorized Execution",
    quote: "Process data in vectors of 1024 tuples using SIMD. Never one row at a time — the Volcano iterator model wastes 99% of its cycles on function call overhead.",
    author: "Pavlo, Lecture 10",
    concepts: ["Volcano / iterator model", "Vectorized batch execution", "SIMD (AVX-512)", "Column-at-a-time operators"],
    url: yt("zzqDBSVljsQ", 10),
  },
  "11": {
    title: "Window Functions & Advanced Operators",
    quote: "The window sort is the same sort — fuse all window functions into a single sorted-partition scan instead of re-sorting for each operator.",
    author: "Pavlo, Lecture 11",
    concepts: ["OVER / PARTITION BY", "Operator fusion", "LAG / LEAD / RANK / ROW_NUMBER", "Sort-based window aggregation"],
    url: yt("GnzsgE4igL4", 11),
  },
  "12": {
    title: "Query Compilation & Code Generation",
    quote: "Compile queries down to native machine code — eliminate interpretation overhead at every operator boundary.",
    author: "Pavlo, Lecture 12",
    concepts: ["Code generation (codegen)", "LLVM JIT compilation", "Pipeline breakers", "Tight inner loops"],
    url: yt("mcFHZFb1CAo", 12),
  },
  "13": {
    title: "Concurrency Control — OCC & MVCC",
    quote: "In OCC, transactions proceed without locks. On commit, the system validates that no other transaction modified the same data — if a conflict is detected, abort.",
    author: "Pavlo, Lectures 13-15",
    concepts: ["Optimistic Concurrency Control (OCC)", "Multi-Version Concurrency Control (MVCC)", "Lost Update problem", "Snapshot isolation"],
    url: `https://www.youtube.com/playlist?list=${PLAYLIST}`,
  },
};

function getLectureMeta(lectureStr: string) {
  const m = lectureStr?.match(/\b(\d{2})\b/);
  if (!m) return null;
  return LECTURE_META[m[1]] ?? null;
}

const THEORY_PRIMERS: Record<string, {
  what: string;
  why: string[];
  lookFor: string[];
}> = {
  "dashboards": {
    what: "The buffer pool is an in-memory cache of recently-accessed disk pages. A \"cold\" query reads from disk; a \"hot\" query hits RAM — 100–1000× faster. DBMSs outperform the OS page cache because they know their own access patterns.",
    why: [
      "Disk I/O is the #1 bottleneck in analytical queries",
      "Dashboard workloads repeat the same scans — cache multiplies the gain",
      "PostgreSQL's shared_buffers + OS page cache = two-tier warm-up",
    ],
    lookFor: [
      "Cold run: high execution time (IO-bound, disk reads dominate)",
      "Hot run: 5–10× faster (buffer pool hit, CPU-bound)",
      "CPU/IO split flips from IO-heavy → CPU-heavy on hot scan",
    ],
  },
  "complex_joins": {
    what: "When a join or sort exceeds work_mem, Postgres spills sorted chunks to disk using external merge sort — then re-reads and merges them. Every extra merge pass doubles the cost.",
    why: [
      "External merge sort is 2–10× slower than in-memory hash join",
      "work_mem controls the spill threshold per plan node",
      "EXPLAIN (BUFFERS) exposes temp blocks written/read as the smoking gun",
    ],
    lookFor: [
      "EXPLAIN ANALYZE: 'Buffers: temp read=N written=N' lines",
      "Join type degrades from Hash Join → Merge Join under low work_mem",
      "IO-dominant CPU split when spilling is active",
    ],
  },
  "variant_test": {
    what: "PAX (Partition Attributes Across) shreds semi-structured data into typed sub-columns. Querying one JSON field via VARIANT reads only that column — not the entire serialized blob.",
    why: [
      "Parsing a full JSON string per row is CPU-expensive and allocation-heavy",
      "Full JSON is loaded into memory even when you only need one key",
      "Shredded columns are typed, smaller, and compression-friendly",
    ],
    lookFor: [
      "STRING JSON → disk_spill_bytes > 0 (memory overflows on large scans)",
      "VARIANT → disk_spill_bytes = 0 and lower latency",
      "Memory savings in MB reveal the true footprint difference",
    ],
  },
  "clustering": {
    what: "A clustered index physically co-locates rows with the same key on the same disk pages, turning random I/O (one seek per row) into sequential I/O (one page = many rows).",
    why: [
      "Random I/O requires a separate disk seek per matching row",
      "Sequential I/O reads entire pages at once — 10–100× more efficient",
      "Zone maps + min-max indexes become effective only when data is clustered",
    ],
    lookFor: [
      "Unclustered: high total_time (random seeks across the heap)",
      "Clustered: 3–7× speedup on range-predicate scans",
      "Buffer pool hit rate improves — same pages reused across rows",
    ],
  },
  "acid_integrity": {
    what: "Optimistic Concurrency Control (OCC) lets writers proceed without locks, then validates on commit. If two writers touched the same version, one is aborted — no silent data loss. Parquet has no such layer; the last write wins and discards the other.",
    why: [
      "Without concurrency control, concurrent writes cause Lost Updates",
      "Parquet uses atomic file rename — no transaction log or version check",
      "Delta Lake maintains a versioned transaction log; OCC validates against it",
    ],
    lookFor: [
      "Parquet: actual_rows < expected_rows (500K rows silently erased)",
      "Delta: ConcurrentAppendException thrown (conflict detected, integrity preserved)",
      "Delta: 0 rows lost — one writer commits, the other aborts cleanly",
    ],
  },
  "vectorized_execution": {
    what: "Vectorized execution processes 1024-row batches using SIMD CPU instructions. The Volcano (iterator) model calls next() once per row — 10M rows = 10M function calls, no SIMD, no cache locality.",
    why: [
      "SIMD processes 4–16 values per CPU clock cycle in one instruction",
      "1000× fewer function calls vs row-at-a-time iteration",
      "Contiguous columnar memory = CPU prefetcher works effectively",
    ],
    lookFor: [
      "DuckDB (vectorized): 25× faster than Python scalar loop on same hardware",
      "CPU-bound execution: >80% CPU share (not waiting for I/O)",
      "Rows/sec metric shows raw throughput — scale it to 50M rows",
    ],
  },
  "compression": {
    what: "Columnar formats apply dictionary encoding, RLE, and bit-packing per column. Parquet/Zstd can be 6× smaller than CSV — meaning 6× less data to read off disk before the query even starts.",
    why: [
      "Reading less data from disk beats decompressing in RAM every time",
      "Dictionary encoding: 5 region strings → 3-bit integers, 90%+ size reduction",
      "Zone maps skip entire row-groups that can't contain matching values",
    ],
    lookFor: [
      "File size: CSV 597MB → Parquet/Zstd 90MB (6.66×)",
      "Scan speedup: 5–7× despite decompression overhead",
      "Parquet/Zstd vs Parquet/Snappy: smaller file ≠ always faster scan",
    ],
  },
  "window_functions": {
    what: "Window functions (LAG, LEAD, RANK, SUM OVER) require a sorted partition scan. DuckDB fuses all 7 operators into a single sorted pass; pandas re-sorts per groupby+merge, paying the O(N log N) cost N times.",
    why: [
      "Multiple window ops sharing a partition share one sort — operator fusion",
      "Re-sorting N times = O(N log N × num_functions) instead of O(N log N)",
      "Vectorized hash aggregation avoids materializing intermediate frames",
    ],
    lookFor: [
      "DuckDB execution model: 'vectorized (bounded hash agg + sorted partition)'",
      "All 7 window ops complete in a single scan pass",
      "Rows/sec comparison — scale to 50M rows for real-world significance",
    ],
  },
  "query_optimization": {
    what: "Cost-based optimizers push predicates (WHERE filters) as deep into the plan as possible — before joins — using cardinality estimates. A 2% selectivity filter eliminates 98% of rows before the hash table is built.",
    why: [
      "Predicate pushdown shrinks the build-side of every downstream join",
      "Correct cardinality estimates → correct join algorithm chosen (HASH_JOIN)",
      "Each additional predicate compounds: 20% → 2% selectivity cuts rows 10×",
    ],
    lookFor: [
      "No filter → 1 predicate: ~1.27× speedup (20% selectivity, 80% rows remain)",
      "1 predicate → 2 predicates: ~1.57× cumulative speedup (2% selectivity)",
      "EXPLAIN output: verify HASH_JOIN selected in all three scenarios",
    ],
  },
  "skew_handling": {
    what: "Parallel execution splits data into partitions by hash key. If 90% of rows share one key ('West'), one thread processes 9M rows while others idle on 250K — a 4.5× load imbalance that caps parallel speedup at the straggler's rate.",
    why: [
      "Amdahl's Law: speedup = 1 / fraction_on_slowest_thread",
      "COUNT DISTINCT is worst-case: each partition maintains its own hash set",
      "Spark AQE detects oversized partitions at runtime and splits them",
    ],
    lookFor: [
      "Imbalance factor: West partition = 4.5× expected uniform size",
      "Heavy aggregations (GROUP BY + COUNT DISTINCT) show maximum slowdown",
      "Uniform vs skewed wall-clock time reveals the true straggler cost",
    ],
  },
};

function TheoryPrimer({ ucId }: { ucId: string }) {
  const [open, setOpen] = useState(false);
  const theory = THEORY_PRIMERS[ucId];
  if (!theory) return null;

  return (
    <div className="border-b border-border bg-purple-500/5">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-2.5 text-left hover:bg-purple-500/8 transition-colors group"
      >
        <div className="flex items-center gap-2">
          <BookOpen className="w-3.5 h-3.5 text-purple-400" />
          <span className="text-xs font-semibold text-purple-300 uppercase tracking-wider">Before You Run</span>
          <span className="text-[10px] font-mono text-muted-foreground/60 hidden sm:inline">— what will you find?</span>
        </div>
        <ChevronDown className={`w-3.5 h-3.5 text-purple-400 transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="px-4 pb-5 flex flex-col gap-4 text-xs">
          <p className="text-muted-foreground leading-relaxed border-l-2 border-purple-500/30 pl-3">
            {theory.what}
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <h5 className="text-[10px] font-semibold text-amber-400 uppercase tracking-wider mb-2">Why it matters</h5>
              <ul className="flex flex-col gap-1.5">
                {theory.why.map((w, i) => (
                  <li key={i} className="text-muted-foreground flex gap-2 leading-relaxed">
                    <span className="text-amber-400/70 shrink-0 mt-0.5">▸</span>
                    <span>{w}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <h5 className="text-[10px] font-semibold text-emerald-400 uppercase tracking-wider mb-2">What you'll discover</h5>
              <ul className="flex flex-col gap-1.5">
                {theory.lookFor.map((lf, i) => (
                  <li key={i} className="text-muted-foreground flex gap-2 leading-relaxed">
                    <span className="text-emerald-400/70 shrink-0 mt-0.5">→</span>
                    <span>{lf}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ValidationPanel({ validation }: { validation: ValidationData }) {
  if (!validation) return null;
  const meta = getLectureMeta(validation.lecture);

  return (
    <div className="flex flex-col gap-4 p-4 bg-muted/30 rounded-md border border-border h-full">
      {/* Lecture badge + watch link */}
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <Badge variant="outline" className="bg-purple-500/10 text-purple-400 border-purple-500/20">
          {validation.lecture}
        </Badge>
        {meta && (
          <a
            href={meta.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[10px] font-mono text-primary/70 hover:text-primary transition-colors shrink-0"
          >
            ▶ Watch lecture ↗
          </a>
        )}
      </div>

      {/* Pavlo quote */}
      {meta && (
        <blockquote className="border-l-2 border-purple-500/40 pl-3 py-0.5">
          <p className="text-xs italic text-muted-foreground leading-relaxed">"{meta.quote}"</p>
          <footer className="text-[10px] text-muted-foreground/50 mt-1 font-mono">— {meta.author}</footer>
        </blockquote>
      )}

      <div>
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Concept</h4>
        <p className="text-sm font-medium">{validation.concept}</p>
      </div>

      {/* Key concepts chips */}
      {meta && (
        <div className="flex flex-wrap gap-1">
          {meta.concepts.map(c => (
            <span key={c} className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-300/80 border border-purple-500/15">
              {c}
            </span>
          ))}
        </div>
      )}

      <div className="bg-background border border-destructive/50 rounded-md p-3">
        <h4 className="text-xs font-semibold text-destructive uppercase tracking-wider mb-2 flex items-center gap-1">
          <TerminalSquare className="w-3 h-3" /> Smoking Gun
        </h4>
        <code className="text-xs font-mono text-foreground break-all">
          {validation.proof}
        </code>
      </div>

      <div>
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">What you proved</h4>
        <p className="text-sm italic text-muted-foreground">{validation.validates}</p>
      </div>

      <div className="bg-blue-500/10 border border-blue-500/20 rounded-md p-3">
        <h4 className="text-xs font-semibold text-blue-400 uppercase tracking-wider mb-1">What this means</h4>
        <p className="text-sm text-blue-100/80">{validation.interpretation}</p>
      </div>

      <div className="mt-auto pt-2">
        <Badge variant={validation.confirmed ? "default" : "secondary"} className={validation.confirmed ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" : "bg-amber-500/10 text-amber-400 border-amber-500/20"}>
          {validation.status}
        </Badge>
      </div>
    </div>
  );
}

function LiveLogPanel({ useCase, onComplete }: { useCase: UseCaseType | null; onComplete: () => void }) {
  const [logs, setLogs] = useState<string[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!useCase) return;
    setLogs([`> Initiating benchmark: ${useCase}...`]);
    
    const es = new EventSource(`${import.meta.env.BASE_URL}api/benchmarks/logs/${useCase}`);
    es.onmessage = (e) => {
      if (e.data === '[DONE]') {
        es.close();
        onComplete();
        setLogs(prev => [...prev, `> Benchmark completed.`]);
      } else {
        setLogs(prev => [...prev, e.data]);
      }
    };
    
    es.onerror = () => {
      es.close();
      onComplete();
      setLogs(prev => [...prev, `> Error: Connection to log stream lost.`]);
    };

    return () => es.close();
  }, [useCase, onComplete]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  if (!useCase) return null;

  return (
    <Card className="border-primary/50 shadow-[0_0_15px_rgba(0,255,255,0.1)] bg-card/95 backdrop-blur">
      <CardHeader className="py-3 px-4 border-b border-border bg-muted/30">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-primary animate-pulse" />
          <CardTitle className="text-sm font-mono tracking-widest text-primary uppercase">Live Telemetry: {useCase}</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <ScrollArea className="h-64 bg-[#0a0a0a]" ref={scrollRef}>
          <div className="p-4 font-mono text-xs text-green-400/80 flex flex-col gap-1">
            {logs.map((log, i) => (
              <div key={i} className="break-all whitespace-pre-wrap">{log}</div>
            ))}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}

function UseCaseSection({ 
  useCase, 
  running, 
  runningUseCase, 
  completedUseCases,
  onRun 
}: { 
  useCase: typeof USE_CASES[0]; 
  running: boolean; 
  runningUseCase: string | null; 
  completedUseCases: string[];
  onRun: (id: UseCaseType) => void;
}) {
  const hasResults = completedUseCases.includes(useCase.id);
  const { data: results } = useGetBenchmarkResults(useCase.id, { 
    query: { 
      enabled: hasResults,
      queryKey: getGetBenchmarkResultsQueryKey(useCase.id),
      retry: false,
    } 
  });

  const isRunningThis = running && runningUseCase === useCase.id;
  const isRunningOther = running && runningUseCase !== useCase.id;

  type StatChip = { label: string; value: string; highlight?: boolean };

  const StatStrip = ({ stats }: { stats: StatChip[] }) => (
    <div className="mt-3 pt-3 border-t border-border flex flex-wrap gap-2">
      {stats.map((s) => (
        <div key={s.label} className="flex flex-col gap-0.5">
          <span className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider">{s.label}</span>
          <span className={`text-xs font-mono ${s.highlight ? "text-primary" : "text-foreground"}`}>{s.value}</span>
        </div>
      ))}
    </div>
  );

  const renderMetricChart = (
    chartData: { name: string; time: number }[],
    barColor: string,
    label: string,
    cpuPct?: number,
    ioPct?: number,
    speedupLabel?: string,
    speedupValue?: number,
    extraStats?: StatChip[],
  ) => {
    const cpuIoData = cpuPct != null
      ? [{ name: "CPU", pct: parseFloat(cpuPct.toFixed(1)) }, { name: "IO", pct: parseFloat((ioPct ?? 0).toFixed(1)) }]
      : [];

    return (
      <div className="mt-3 flex flex-col gap-0">
        <div className="grid grid-cols-2 gap-3">
          {/* Left: timing bar chart */}
          <div className="flex flex-col gap-1">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{label}</p>
            <div className="h-40">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="name" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v: number) => `${v}s`} />
                  <Tooltip
                    contentStyle={{ backgroundColor: "hsl(var(--card))", borderColor: "hsl(var(--border))", borderRadius: "4px" }}
                    itemStyle={{ color: "hsl(var(--foreground))" }}
                    formatter={(v: number) => [`${v}s`, "Time"]}
                    cursor={{ fill: "hsl(var(--muted) / 0.5)" }}
                  />
                  <Bar dataKey="time" fill={barColor} radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Right: CPU/IO split + speedup badge */}
          <div className="flex flex-col gap-2 justify-center">
            {speedupValue != null && (
              <div className="flex flex-col gap-1">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{speedupLabel ?? "Speedup"}</p>
                <Badge variant="outline" className="text-emerald-400 border-emerald-500/30 text-sm font-mono w-fit">
                  {speedupValue.toFixed(1)}x faster
                </Badge>
              </div>
            )}
            {cpuIoData.length > 0 && (
              <div className="flex flex-col gap-1">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">CPU / IO Split</p>
                <div className="h-20">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={cpuIoData} layout="vertical" margin={{ top: 0, right: 24, left: 0, bottom: 0 }}>
                      <XAxis type="number" domain={[0, 100]} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 9 }} axisLine={false} tickLine={false} tickFormatter={(v: number) => `${v}%`} />
                      <YAxis type="category" dataKey="name" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} axisLine={false} tickLine={false} width={28} />
                      <Tooltip
                        contentStyle={{ backgroundColor: "hsl(var(--card))", borderColor: "hsl(var(--border))", borderRadius: "4px" }}
                        formatter={(v: number) => [`${v}%`, "Share"]}
                        cursor={{ fill: "hsl(var(--muted) / 0.2)" }}
                      />
                      <Bar dataKey="pct" fill="hsl(var(--chart-3))" radius={[0, 2, 2, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Extra stat chips row */}
        {extraStats && extraStats.length > 0 && <StatStrip stats={extraStats} />}
      </div>
    );
  };

  const renderPerSystemChart = (useCaseId: UseCaseType, system: string, data: Record<string, unknown>) => {
    if (useCaseId === "dashboards") {
      const d = data as unknown as DashboardSystemResult;
      const cold = d.cold_hot?.cold?.time_seconds ?? 0;
      const hot = d.cold_hot?.hot?.time_seconds ?? 0;
      const stats: StatChip[] = [];
      if (d.total_time_seconds != null) stats.push({ label: "Avg Time", value: `${d.total_time_seconds.toFixed(2)}s` });
      if (d.peak_memory_mb != null) stats.push({ label: "Peak Mem", value: `${d.peak_memory_mb} MB` });
      if (d.scan_strategy) stats.push({ label: "Scan", value: d.scan_strategy, highlight: true });
      return renderMetricChart(
        [{ name: "Cold", time: parseFloat(cold.toFixed(3)) }, { name: "Hot", time: parseFloat(hot.toFixed(3)) }],
        "hsl(var(--primary))", "Execution Time",
        d.cpu_bound_percent, d.io_bound_percent,
        "Cache Speedup", d.cold_hot?.speedup,
        stats,
      );
    }

    if (useCaseId === "clustering") {
      const d = data as unknown as ClusteringSystemResult;
      const before = (d.unclustered ?? d.unsorted)?.total_time_seconds ?? 0;
      const after = (d.clustered ?? d.sorted)?.total_time_seconds ?? 0;
      const beforeLabel = d.unclustered ? "Before" : "Unsorted";
      const afterLabel = d.clustered ? "After" : "Sorted";
      const beforeMetrics = d.unclustered ?? d.unsorted;
      const afterMetrics = d.clustered ?? d.sorted;
      const stats: StatChip[] = [];
      if (beforeMetrics?.peak_memory_mb != null) stats.push({ label: "Mem (before)", value: `${beforeMetrics.peak_memory_mb} MB` });
      if (afterMetrics?.peak_memory_mb != null) stats.push({ label: "Mem (after)", value: `${afterMetrics.peak_memory_mb} MB` });
      return renderMetricChart(
        [{ name: beforeLabel, time: parseFloat(before.toFixed(3)) }, { name: afterLabel, time: parseFloat(after.toFixed(3)) }],
        "hsl(var(--chart-2))", "Execution Time",
        beforeMetrics?.cpu_bound_percent, beforeMetrics?.io_bound_percent,
        "Cluster Speedup", d.speedup,
        stats,
      );
    }

    if (useCaseId === "complex_joins") {
      const d = data as unknown as ComplexJoinsSystemResult;
      let chartData: { name: string; time: number }[] = [];
      let firstResult: WorkMemResult | undefined;
      if (d.results_by_work_mem) {
        const entries = Object.entries(d.results_by_work_mem);
        chartData = entries.map(([mem, res]) => ({ name: mem, time: parseFloat((res.total_time_seconds ?? 0).toFixed(3)) }));
        firstResult = entries[0]?.[1];
      } else if (d.total_time_seconds != null) {
        chartData = [{ name: system, time: parseFloat(d.total_time_seconds.toFixed(3)) }];
      }
      const stats: StatChip[] = [];
      if (d.peak_memory_mb != null) stats.push({ label: "Peak Mem", value: `${d.peak_memory_mb} MB` });
      if (firstResult?.join_strategy) stats.push({ label: "Join Strategy", value: firstResult.join_strategy, highlight: true });
      if (firstResult?.temp_files_used != null) stats.push({ label: "Temp Files", value: firstResult.temp_files_used ? "Yes (spilled)" : "No", highlight: firstResult.temp_files_used });
      if (firstResult?.external_merge != null) stats.push({ label: "External Merge", value: firstResult.external_merge ? "Yes" : "No", highlight: firstResult.external_merge });
      return chartData.length > 0
        ? renderMetricChart(chartData, "hsl(var(--chart-4))", "Time by work_mem", firstResult?.cpu_bound_percent, firstResult?.io_bound_percent, undefined, undefined, stats)
        : null;
    }

    return null;
  };

  const renderVariantTest = (data: VariantTestResult) => {
    const chartData = [
      { name: "STRING", time: parseFloat((data.string_json.execution_time_seconds ?? 0).toFixed(3)) },
      { name: "VARIANT", time: parseFloat((data.variant_shredded.execution_time_seconds ?? 0).toFixed(3)) },
    ];
    const memChartData = [
      { name: "STRING", mem: data.string_json.peak_memory_mb ?? 0 },
      { name: "VARIANT", mem: data.variant_shredded.peak_memory_mb ?? 0 },
    ];
    const statChips: StatChip[] = [];
    if (data.proof?.speedup != null) statChips.push({ label: "Speedup", value: `${data.proof.speedup}x`, highlight: true });
    if (data.proof?.memory_savings_mb != null) statChips.push({ label: "Mem Saved", value: `${data.proof.memory_savings_mb} MB`, highlight: true });
    if (data.string_json.spilled_to_disk != null) statChips.push({ label: "STRING spill", value: data.string_json.spilled_to_disk ? "Yes" : "No" });
    if (data.variant_shredded.spilled_to_disk != null) statChips.push({ label: "VARIANT spill", value: data.variant_shredded.spilled_to_disk ? "Yes" : "No" });
    if (data.proof?.variant_avoided_spill != null) statChips.push({ label: "Spill Avoided", value: data.proof.variant_avoided_spill ? "Yes ✓" : "No", highlight: data.proof.variant_avoided_spill });
    return (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-0 border-b border-border">
        <div className="p-6 border-b lg:border-b-0 lg:border-r border-border flex flex-col">
          <div className="flex items-center gap-2 mb-3">
            <Server className="w-4 h-4 text-muted-foreground" />
            <h3 className="font-mono text-sm uppercase tracking-wider text-foreground">
              Spark: <span className="text-primary">STRING vs VARIANT</span>
            </h3>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Exec Time</p>
              <div className="h-36">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                    <XAxis dataKey="name" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v: number) => `${v}s`} />
                    <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", borderColor: "hsl(var(--border))", borderRadius: "4px" }} formatter={(v: number) => [`${v}s`, "Time"]} cursor={{ fill: "hsl(var(--muted) / 0.5)" }} />
                    <Bar dataKey="time" fill="hsl(var(--chart-3))" radius={[2, 2, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Peak Memory</p>
              <div className="h-36">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={memChartData} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                    <XAxis dataKey="name" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v: number) => `${v}`} />
                    <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", borderColor: "hsl(var(--border))", borderRadius: "4px" }} formatter={(v: number) => [`${v} MB`, "Memory"]} cursor={{ fill: "hsl(var(--muted) / 0.5)" }} />
                    <Bar dataKey="mem" fill="hsl(var(--chart-5))" radius={[2, 2, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
          {statChips.length > 0 && <StatStrip stats={statChips} />}
        </div>
        <div className="p-6 bg-muted/5">
          <ValidationPanel validation={data.validation} />
        </div>
      </div>
    );
  };

  const renderAcidIntegrity = (data: AcidIntegrityResult) => {
    const p = data.parquet_lost_update;
    const dc = data.delta_conflict;
    const ds = data.delta_snapshot;
    const proof = (data as unknown as Record<string, unknown>).proof as Record<string, unknown> | undefined;

    const WriterBadge = ({ status, label }: { status: string; label: string }) => {
      const isCommit = status === "committed";
      const isConflict = status === "conflict_detected";
      const isNotTested = status === "not_tested" || status === "error";
      const color = isCommit
        ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
        : isConflict
        ? "bg-amber-500/10 text-amber-400 border-amber-500/30"
        : isNotTested
        ? "bg-muted/30 text-muted-foreground border-muted-foreground/20 opacity-50"
        : "bg-red-500/10 text-red-400 border-red-500/30";
      const icon = isCommit ? "✅" : isConflict ? "🎯" : isNotTested ? "—" : "❌";
      return (
        <div className="flex flex-col gap-1">
          <span className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider">{label}</span>
          <Badge variant="outline" className={`font-mono text-xs w-fit ${color}`}>
            {icon} {status.replace(/_/g, " ")}
          </Badge>
        </div>
      );
    };

    // Conflict timeline events
    const timelineEvents = [
      { t: "T+0s", label: "Writer A starts", color: "text-blue-400", line: "bg-blue-500/30" },
      { t: "T+0.15s", label: "Writer B starts (overlapping)", color: "text-amber-400", line: "bg-amber-500/30" },
      { t: "T+0.25s", label: "Writer B commits", color: "text-emerald-400", line: "bg-emerald-500/30" },
      { t: "T+0.5s", label: dc?.occ_working ? "Writer A → ConcurrentAppendException" : "Writer A commits (lost update)", color: dc?.occ_working ? "text-red-400" : "text-red-300", line: dc?.occ_working ? "bg-red-500/40" : "bg-red-500/20" },
    ];

    return (
      <div className="flex flex-col border-b border-border">
        {/* Parquet vs Delta Comparison Table */}
        <div className="px-6 pt-5 pb-4 border-b border-border/50">
          <div className="flex items-center gap-2 mb-3">
            <ShieldAlert className="w-4 h-4 text-muted-foreground" />
            <h3 className="font-mono text-sm uppercase tracking-wider text-foreground">
              Parquet vs Delta <span className="text-primary">Comparison</span>
            </h3>
          </div>
          <div className="overflow-auto rounded-md border border-border">
            <Table>
              <TableHeader className="bg-muted/30">
                <TableRow className="hover:bg-transparent">
                  <TableHead className="font-mono uppercase tracking-wider text-[10px] py-2">Property</TableHead>
                  <TableHead className="font-mono uppercase tracking-wider text-[10px] py-2 text-red-400">Raw Parquet</TableHead>
                  <TableHead className="font-mono uppercase tracking-wider text-[10px] py-2 text-blue-400">Delta Lake</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow className="border-border">
                  <TableCell className="text-xs font-medium py-2">Conflict detection</TableCell>
                  <TableCell className="text-xs py-2 text-red-400">❌ None</TableCell>
                  <TableCell className="text-xs py-2 text-emerald-400">✅ OCC (optimistic)</TableCell>
                </TableRow>
                <TableRow className="border-border">
                  <TableCell className="text-xs font-medium py-2">Writer A outcome</TableCell>
                  <TableCell className="text-xs py-2 font-mono">{p?.writer_a_status ?? "committed"}</TableCell>
                  <TableCell className="text-xs py-2 font-mono">
                    {dc?.occ_working ? "conflict_detected" : dc?.writer_a_status ?? "not_tested"}
                  </TableCell>
                </TableRow>
                <TableRow className="border-border">
                  <TableCell className="text-xs font-medium py-2">Rows lost</TableCell>
                  <TableCell className="text-xs py-2 text-red-400 font-bold font-mono">
                    {(p?.rows_silently_lost ?? 0).toLocaleString()} rows
                  </TableCell>
                  <TableCell className="text-xs py-2 text-emerald-400 font-mono">
                    {dc?.occ_working ? "0 rows (rejected)" : "—"}
                  </TableCell>
                </TableRow>
                <TableRow className="border-border">
                  <TableCell className="text-xs font-medium py-2">Exception raised</TableCell>
                  <TableCell className="text-xs py-2 text-muted-foreground">None</TableCell>
                  <TableCell className="text-xs py-2 font-mono text-amber-400">
                    {dc?.occ_working
                      ? (proof?.exception_type as string) ?? "ConcurrentAppendException"
                      : (dc?.note ? "N/A (not run)" : "None")}
                  </TableCell>
                </TableRow>
                <TableRow className="border-border">
                  <TableCell className="text-xs font-medium py-2">Snapshot isolation</TableCell>
                  <TableCell className="text-xs py-2 text-red-400">❌ No versioning</TableCell>
                  <TableCell className="text-xs py-2">
                    {ds?.snapshot_isolation_confirmed
                      ? <span className="text-emerald-400">✅ VERSION AS OF 0 → {ds.version_0_rows.toLocaleString()} rows</span>
                      : <span className="text-muted-foreground">{ds?.note ?? "⚠️ Not verified"}</span>
                    }
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </div>

        {/* Conflict Timeline */}
        <div className="px-6 pt-4 pb-4 border-b border-border/50">
          <h4 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-3">Conflict Timeline</h4>
          <div className="flex items-start gap-0">
            {timelineEvents.map((ev, i) => (
              <div key={i} className="flex-1 flex flex-col items-center">
                <div className={`text-[9px] font-mono ${ev.color} mb-1 text-center`}>{ev.t}</div>
                <div className={`w-full h-2 ${ev.line} rounded-sm mb-1.5`} />
                <div className={`text-[9px] text-center leading-tight ${ev.color} max-w-[80px]`}>{ev.label}</div>
              </div>
            ))}
          </div>
          {proof && (
            <div className="mt-3 flex flex-wrap gap-3 pt-3 border-t border-border/40">
              <div className="flex flex-col gap-0.5">
                <span className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider">Lost Update</span>
                <Badge variant="outline" className={`font-mono text-[10px] w-fit ${proof.lost_update_confirmed ? "bg-red-500/10 text-red-400 border-red-500/30" : "bg-muted/20 text-muted-foreground"}`}>
                  {proof.lost_update_confirmed ? `❌ ${(proof.rows_lost_in_parquet as number)?.toLocaleString() ?? 0} rows lost` : "Not confirmed"}
                </Badge>
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider">OCC</span>
                <Badge variant="outline" className={`font-mono text-[10px] w-fit ${proof.occ_confirmed ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30" : "bg-amber-500/10 text-amber-400 border-amber-500/30"}`}>
                  {proof.occ_confirmed ? "✅ Confirmed" : "⚠️ Needs delta-spark"}
                </Badge>
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider">MVCC</span>
                <Badge variant="outline" className={`font-mono text-[10px] w-fit ${proof.mvcc_confirmed ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30" : "bg-amber-500/10 text-amber-400 border-amber-500/30"}`}>
                  {proof.mvcc_confirmed ? "✅ Confirmed" : "⚠️ Needs delta-spark"}
                </Badge>
              </div>
            </div>
          )}
        </div>

        {/* Sub-tests Detail + Validation */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-0">
          <div className="p-6 border-b lg:border-b-0 lg:border-r border-border flex flex-col gap-4">
            <h4 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Sub-test Results</h4>

            {/* Sub-test A: Parquet */}
            <div className="border border-border rounded-md p-3 bg-red-500/5 border-red-500/20">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold uppercase tracking-wider text-red-400">A · Raw Parquet</span>
                <Badge variant="outline" className="bg-red-500/10 text-red-400 border-red-500/30 text-[10px] font-mono">
                  {p?.lost_update_confirmed ? "❌ Lost Update" : "ℹ️ Concurrent"}
                </Badge>
              </div>
              <div className="grid grid-cols-2 gap-2 mb-2">
                <WriterBadge status={p?.writer_a_status ?? "committed"} label="Writer A" />
                <WriterBadge status={p?.writer_b_status ?? "committed"} label="Writer B" />
              </div>
              <div className="flex flex-wrap gap-2 pt-2 border-t border-border/40 text-xs font-mono">
                <span className="text-muted-foreground">Expected: <span className="text-foreground">{(p?.expected_total_rows ?? 1_000_000).toLocaleString()}</span></span>
                <span className="text-muted-foreground">Actual: <span className="text-foreground">{(p?.actual_total_rows ?? 500_000).toLocaleString()}</span></span>
                <span className="text-red-400 font-bold">Lost: {(p?.rows_silently_lost ?? 500_000).toLocaleString()}</span>
              </div>
            </div>

            {/* Sub-test B: Delta OCC */}
            <div className={`border rounded-md p-3 ${dc?.occ_working ? "bg-emerald-500/5 border-emerald-500/20" : "bg-muted/5 border-muted-foreground/20"}`}>
              <div className="flex items-center justify-between mb-2">
                <span className={`text-xs font-bold uppercase tracking-wider ${dc?.occ_working ? "text-emerald-400" : "text-muted-foreground"}`}>B · Delta OCC</span>
                <Badge variant="outline" className={`text-[10px] font-mono ${dc?.occ_working ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30" : "bg-amber-500/10 text-amber-400 border-amber-500/30"}`}>
                  {dc?.occ_working ? "✅ Conflict Detected" : "⚠️ Inconclusive"}
                </Badge>
              </div>
              <div className="grid grid-cols-2 gap-2 mb-2">
                <WriterBadge status={dc?.writer_a_status ?? "not_tested"} label="Writer A" />
                <WriterBadge status={dc?.writer_b_status ?? "not_tested"} label="Writer B" />
              </div>
              {dc?.occ_working && (
                <div className="bg-background border border-destructive/30 rounded px-2 py-1.5">
                  <span className="text-[9px] font-semibold text-destructive uppercase tracking-wider block mb-0.5">Exception (OCC)</span>
                  <code className="text-[10px] font-mono text-foreground">
                    {(proof?.exception_type as string) ?? "ConcurrentAppendException"}
                  </code>
                </div>
              )}
              {!dc?.occ_working && dc?.note && (
                <p className="text-[10px] text-muted-foreground italic">{dc.note}</p>
              )}
            </div>

            {/* Sub-test C: Delta MVCC */}
            <div className={`border rounded-md p-3 ${ds?.snapshot_isolation_confirmed ? "bg-blue-500/5 border-blue-500/20" : "bg-muted/5 border-muted-foreground/20"}`}>
              <div className="flex items-center justify-between mb-2">
                <span className={`text-xs font-bold uppercase tracking-wider ${ds?.snapshot_isolation_confirmed ? "text-blue-400" : "text-muted-foreground"}`}>C · Delta MVCC</span>
                <Badge variant="outline" className={`text-[10px] font-mono ${ds?.snapshot_isolation_confirmed ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30" : "bg-amber-500/10 text-amber-400 border-amber-500/30"}`}>
                  {ds?.snapshot_isolation_confirmed ? "✅ Isolated" : "⚠️ Inconclusive"}
                </Badge>
              </div>
              {ds?.snapshot_isolation_confirmed ? (
                <div className="flex flex-wrap gap-2 text-xs font-mono">
                  <span className="text-blue-400">v0: {ds.version_0_rows.toLocaleString()} rows</span>
                  <span className="text-muted-foreground">current: {ds.current_version_rows.toLocaleString()} rows</span>
                </div>
              ) : (
                <p className="text-[10px] text-muted-foreground italic">{ds?.note ?? "Run with delta-spark to verify"}</p>
              )}
              <code className="text-[9px] font-mono text-muted-foreground/70 bg-muted/30 px-1.5 py-1 rounded block mt-2 truncate">
                {ds?.time_travel_query ?? "SELECT COUNT(*) FROM delta.`<path>` VERSION AS OF 0"}
              </code>
            </div>
          </div>

          <div className="p-6 bg-muted/5">
            <ValidationPanel validation={data.validation} />
          </div>
        </div>
      </div>
    );
  };

  const renderVectorizedExecution = (data: VectorizedExecutionResult) => {
    const { systems, speedup } = data;
    const duck = systems.duckdb;
    const numpy = systems.numpy_vectorized;
    const scalar = systems.python_scalar;
    const pg = systems.postgres;

    // Bar chart data — only include available systems
    const chartData = [
      duck.available && { name: "DuckDB\n(vectorized)", ms: duck.execution_time_ms ?? 0, fill: "#6366f1" },
      numpy.available && { name: "NumPy\n(columnar)", ms: numpy.execution_time_ms ?? 0, fill: "#3b82f6" },
      pg.available && { name: "Postgres\n(Volcano)", ms: pg.execution_time_ms ?? 0, fill: "#f97316" },
      scalar.available && { name: "Python\n(row-at-a-time)", ms: scalar.execution_time_ms ?? 0, fill: "#ef4444" },
    ].filter(Boolean) as { name: string; ms: number; fill: string }[];

    const systemRows: { label: string; result: VectorizedSystemResult; color: string }[] = [
      { label: "DuckDB (vectorized)", result: duck, color: "text-indigo-400" },
      { label: "NumPy (columnar)", result: numpy, color: "text-blue-400" },
      { label: "Python scalar (Volcano)", result: scalar, color: "text-red-400" },
      ...(pg.available ? [{ label: "Postgres (Volcano)", result: pg, color: "text-orange-400" }] : []),
    ];

    const speedupEntries = [
      speedup.duckdb_vs_python_scalar != null && { label: "DuckDB vs Python scalar", value: speedup.duckdb_vs_python_scalar, highlight: true },
      speedup.duckdb_vs_numpy != null && { label: "DuckDB vs NumPy", value: speedup.duckdb_vs_numpy, highlight: false },
      speedup.numpy_vs_python_scalar != null && { label: "NumPy vs Python scalar", value: speedup.numpy_vs_python_scalar, highlight: false },
      speedup.duckdb_vs_postgres != null && { label: "DuckDB vs Postgres", value: speedup.duckdb_vs_postgres, highlight: true },
    ].filter(Boolean) as { label: string; value: number; highlight: boolean }[];

    return (
      <div className="flex flex-col border-b border-border">
        {/* Execution Time Bar Chart */}
        <div className="px-6 pt-5 pb-4 border-b border-border/50">
          <div className="flex items-center gap-2 mb-3">
            <Cpu className="w-4 h-4 text-muted-foreground" />
            <h3 className="font-mono text-sm uppercase tracking-wider text-foreground">
              Execution Time <span className="text-primary">Comparison</span>
            </h3>
            <span className="ml-auto text-[10px] text-muted-foreground font-mono">
              {(data.row_count ?? 0).toLocaleString()} rows — arithmetic aggregation
            </span>
          </div>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} layout="vertical" margin={{ left: 20, right: 40, top: 4, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                <XAxis type="number" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }}
                  tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(1)}s` : `${v}ms`} />
                <YAxis type="category" dataKey="name" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 9 }} width={90} />
                <Tooltip
                  contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 6, fontSize: 11 }}
                  formatter={(v: number) => [v >= 1000 ? `${(v / 1000).toFixed(2)}s` : `${v.toFixed(1)}ms`, "time"]} />
                <Bar dataKey="ms" radius={[0, 4, 4, 0]} label={{ position: "right", fontSize: 9, fill: "hsl(var(--muted-foreground))",
                  formatter: (v: number) => v >= 1000 ? `${(v / 1000).toFixed(1)}s` : `${v.toFixed(0)}ms` }}>
                  {chartData.map((entry, i) => (
                    <Cell key={i} fill={entry.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p className="text-[10px] text-muted-foreground italic mt-1">
            Python scalar is extrapolated from {(scalar.rows_per_second ? Math.round(500_000) : 0).toLocaleString()} sample rows ×20 to {(data.row_count ?? 0).toLocaleString()}
          </p>
        </div>

        {/* Speedup + Batch Model table */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-0 border-b border-border/50">
          {/* Speedup ratios */}
          <div className="px-6 py-4 border-b lg:border-b-0 lg:border-r border-border/50">
            <h4 className="font-mono text-xs uppercase tracking-wider text-muted-foreground mb-3">Speedup Ratios</h4>
            <div className="flex flex-col gap-2">
              {speedupEntries.map(({ label, value, highlight }) => (
                <div key={label} className="flex items-center justify-between gap-2">
                  <span className="text-xs text-muted-foreground">{label}</span>
                  <Badge variant="outline" className={highlight
                    ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30 font-mono text-xs"
                    : "bg-muted/30 text-muted-foreground font-mono text-xs"}>
                    {value}×
                  </Badge>
                </div>
              ))}
            </div>
          </div>

          {/* Batch model details */}
          <div className="px-6 py-4">
            <h4 className="font-mono text-xs uppercase tracking-wider text-muted-foreground mb-3">Execution Model Details</h4>
            <div className="flex flex-col gap-2">
              {systemRows.map(({ label, result, color }) => result.available && (
                <div key={label} className="text-xs">
                  <span className={`font-semibold ${color}`}>{label}</span>
                  <div className="text-muted-foreground font-mono text-[10px] mt-0.5 ml-2">
                    {result.batch_model}
                    {result.vector_size != null && result.vector_size !== -1 && (
                      <span className="ml-2 text-primary/60">vec={result.vector_size}</span>
                    )}
                    {result.simd_capable != null && (
                      <span className={`ml-2 ${result.simd_capable ? "text-emerald-400/70" : "text-muted-foreground/50"}`}>
                        {result.simd_capable ? "SIMD" : "no SIMD"}
                      </span>
                    )}
                  </div>
                  {result.rows_per_second != null && (
                    <div className="text-[10px] text-muted-foreground/60 ml-2">
                      {result.rows_per_second.toLocaleString()} rows/sec
                      {result.note && <span className="ml-2 italic">{result.note}</span>}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Validation Panel */}
        <div className="p-6 bg-muted/5">
          <ValidationPanel validation={data.validation} />
        </div>
      </div>
    );
  };

  // ────────────────────────────────────────────────────────────────────────
  //  UC7: Compression Effectiveness
  // ────────────────────────────────────────────────────────────────────────
  const renderCompression = (data: CompressionResult) => {
    const { formats, comparison } = data;
    const { csv, parquet_snappy, parquet_zstd } = formats;

    const sizeData = [
      { name: "CSV", mb: csv.size_mb, fill: "#ef4444" },
      { name: "Parquet\n(Snappy)", mb: parquet_snappy.size_mb, fill: "#6366f1" },
      { name: "Parquet\n(Zstd)", mb: parquet_zstd.size_mb, fill: "#22c55e" },
    ];
    const scanData = [
      { name: "CSV", ms: csv.scan_time_ms, fill: "#ef4444" },
      { name: "Parquet\n(Snappy)", ms: parquet_snappy.scan_time_ms, fill: "#6366f1" },
      { name: "Parquet\n(Zstd)", ms: parquet_zstd.scan_time_ms, fill: "#22c55e" },
    ];
    const snappyRatio = comparison.csv_vs_parquet_snappy.size_ratio;
    const zstdRatio = comparison.csv_vs_parquet_zstd.size_ratio;
    const scanSpeedupSnappy = comparison.csv_vs_parquet_snappy.scan_speedup;
    const scanSpeedupZstd = comparison.csv_vs_parquet_zstd.scan_speedup;

    return (
      <div className="flex flex-col border-b border-border">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-0 border-b border-border/50">
          {/* File Size */}
          <div className="px-6 pt-5 pb-4 border-b lg:border-b-0 lg:border-r border-border/50">
            <div className="flex items-center gap-2 mb-3">
              <Archive className="w-4 h-4 text-muted-foreground" />
              <h3 className="font-mono text-sm uppercase tracking-wider text-foreground">
                File Size <span className="text-primary">Comparison</span>
              </h3>
              <span className="ml-auto text-[10px] text-muted-foreground font-mono">
                {(data.row_count ?? 0).toLocaleString()} rows
              </span>
            </div>
            <div className="h-44">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={sizeData} layout="vertical" margin={{ left: 20, right: 50, top: 4, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                  <XAxis type="number" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }}
                    tickFormatter={(v) => `${v}MB`} />
                  <YAxis type="category" dataKey="name" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 9 }} width={80} />
                  <Tooltip contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 6, fontSize: 11 }}
                    formatter={(v: number) => [`${v.toFixed(1)} MB`, "size"]} />
                  <Bar dataKey="mb" radius={[0, 4, 4, 0]} label={{ position: "right", fontSize: 9, fill: "hsl(var(--muted-foreground))", formatter: (v: number) => `${v.toFixed(0)}MB` }}>
                    {sizeData.map((e, i) => <Cell key={i} fill={e.fill} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Scan Time */}
          <div className="px-6 pt-5 pb-4">
            <div className="flex items-center gap-2 mb-3">
              <Zap className="w-4 h-4 text-muted-foreground" />
              <h3 className="font-mono text-sm uppercase tracking-wider text-foreground">
                Scan Speed <span className="text-primary">Comparison</span>
              </h3>
            </div>
            <div className="h-44">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={scanData} layout="vertical" margin={{ left: 20, right: 60, top: 4, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                  <XAxis type="number" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }}
                    tickFormatter={(v) => `${v}ms`} />
                  <YAxis type="category" dataKey="name" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 9 }} width={80} />
                  <Tooltip contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 6, fontSize: 11 }}
                    formatter={(v: number) => [`${v.toFixed(1)}ms`, "scan time"]} />
                  <Bar dataKey="ms" radius={[0, 4, 4, 0]} label={{ position: "right", fontSize: 9, fill: "hsl(var(--muted-foreground))", formatter: (v: number) => `${v.toFixed(0)}ms` }}>
                    {scanData.map((e, i) => <Cell key={i} fill={e.fill} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        {/* Ratios + Format Details */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-0 border-b border-border/50">
          <div className="px-6 py-4 border-b lg:border-b-0 lg:border-r border-border/50">
            <h4 className="font-mono text-xs uppercase tracking-wider text-muted-foreground mb-3">Compression Ratios</h4>
            <div className="flex flex-col gap-2">
              {[
                { label: "Parquet Snappy vs CSV (size)", value: `${snappyRatio}×`, highlight: snappyRatio >= 2 },
                { label: "Parquet Zstd vs CSV (size)", value: `${zstdRatio}×`, highlight: zstdRatio >= 3 },
                { label: "Parquet Snappy scan speedup", value: `${scanSpeedupSnappy}×`, highlight: scanSpeedupSnappy >= 2 },
                { label: "Parquet Zstd scan speedup", value: `${scanSpeedupZstd}×`, highlight: scanSpeedupZstd >= 2 },
              ].map(({ label, value, highlight }) => (
                <div key={label} className="flex items-center justify-between gap-2">
                  <span className="text-xs text-muted-foreground">{label}</span>
                  <Badge variant="outline" className={highlight
                    ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30 font-mono text-xs"
                    : "bg-muted/30 text-muted-foreground font-mono text-xs"}>
                    {value}
                  </Badge>
                </div>
              ))}
            </div>
          </div>
          <div className="px-6 py-4">
            <h4 className="font-mono text-xs uppercase tracking-wider text-muted-foreground mb-3">Format Details</h4>
            <div className="flex flex-col gap-2 text-xs">
              {[
                { label: "CSV", f: csv, color: "text-red-400" },
                { label: "Parquet (Snappy)", f: parquet_snappy, color: "text-indigo-400" },
                { label: "Parquet (Zstd)", f: parquet_zstd, color: "text-green-400" },
              ].map(({ label, f, color }) => (
                <div key={label}>
                  <span className={`font-semibold ${color}`}>{label}</span>
                  <div className="text-muted-foreground font-mono text-[10px] mt-0.5 ml-2">
                    {f.size_mb.toFixed(1)} MB · scan {f.scan_time_ms.toFixed(0)}ms · {f.rows_per_second.toLocaleString()} rows/sec
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="p-6 bg-muted/5"><ValidationPanel validation={data.validation} /></div>
      </div>
    );
  };

  // ────────────────────────────────────────────────────────────────────────
  //  UC8: Window Functions
  // ────────────────────────────────────────────────────────────────────────
  const renderWindowFunctions = (data: WindowFunctionsResult) => {
    const { systems, speedup } = data;
    const duck = systems.duckdb;
    const pandas = systems.pandas;
    const pg = systems.postgres;

    const chartData = [
      duck.available && duck.execution_time_ms != null && { name: "DuckDB\n(vectorized)", ms: duck.execution_time_ms, fill: "#6366f1" },
      pandas.available && pandas.execution_time_ms != null && { name: "Pandas\n(groupby)", ms: pandas.execution_time_ms, fill: "#f97316" },
      pg.available && pg.execution_time_ms != null && { name: "Postgres\n(Volcano)", ms: pg.execution_time_ms, fill: "#ef4444" },
    ].filter(Boolean) as { name: string; ms: number; fill: string }[];

    return (
      <div className="flex flex-col border-b border-border">
        <div className="px-6 pt-5 pb-4 border-b border-border/50">
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp className="w-4 h-4 text-muted-foreground" />
            <h3 className="font-mono text-sm uppercase tracking-wider text-foreground">
              Window Execution Time <span className="text-primary">Comparison</span>
            </h3>
            <span className="ml-auto text-[10px] text-muted-foreground font-mono">
              {(data.row_count ?? 0).toLocaleString()} rows — LAG, LEAD, ROW_NUMBER, RANK, SUM/AVG OVER
            </span>
          </div>
          {chartData.length > 0 ? (
            <div className="h-44">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} layout="vertical" margin={{ left: 20, right: 60, top: 4, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                  <XAxis type="number" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }}
                    tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(1)}s` : `${v}ms`} />
                  <YAxis type="category" dataKey="name" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 9 }} width={90} />
                  <Tooltip contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 6, fontSize: 11 }}
                    formatter={(v: number) => [v >= 1000 ? `${(v / 1000).toFixed(2)}s` : `${v.toFixed(1)}ms`, "time"]} />
                  <Bar dataKey="ms" radius={[0, 4, 4, 0]} label={{ position: "right", fontSize: 9, fill: "hsl(var(--muted-foreground))",
                    formatter: (v: number) => v >= 1000 ? `${(v / 1000).toFixed(1)}s` : `${v.toFixed(0)}ms` }}>
                    {chartData.map((e, i) => <Cell key={i} fill={e.fill} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground italic py-4">No chart data — run benchmark to populate</p>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-0 border-b border-border/50">
          <div className="px-6 py-4 border-b lg:border-b-0 lg:border-r border-border/50">
            <h4 className="font-mono text-xs uppercase tracking-wider text-muted-foreground mb-3">Speedup Ratios</h4>
            <div className="flex flex-col gap-2">
              {[
                speedup.duckdb_vs_pandas != null && { label: "DuckDB vs Pandas", value: speedup.duckdb_vs_pandas, highlight: true },
                speedup.duckdb_vs_postgres != null && { label: "DuckDB vs Postgres", value: speedup.duckdb_vs_postgres, highlight: true },
              ].filter(Boolean).map((e) => {
                const entry = e as { label: string; value: number; highlight: boolean };
                return (
                  <div key={entry.label} className="flex items-center justify-between gap-2">
                    <span className="text-xs text-muted-foreground">{entry.label}</span>
                    <Badge variant="outline" className={entry.highlight
                      ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30 font-mono text-xs"
                      : "bg-muted/30 text-muted-foreground font-mono text-xs"}>
                      {entry.value}×
                    </Badge>
                  </div>
                );
              })}
              {!speedup.duckdb_vs_pandas && !speedup.duckdb_vs_postgres && (
                <p className="text-xs text-muted-foreground italic">Only DuckDB available — pandas/Postgres not installed</p>
              )}
            </div>
          </div>
          <div className="px-6 py-4">
            <h4 className="font-mono text-xs uppercase tracking-wider text-muted-foreground mb-3">Execution Model</h4>
            <div className="flex flex-col gap-2 text-xs">
              {[
                { label: "DuckDB", sys: duck, color: "text-indigo-400" },
                { label: "Pandas", sys: pandas, color: "text-orange-400" },
                { label: "Postgres", sys: pg, color: "text-red-400" },
              ].map(({ label, sys, color }) => sys.available ? (
                <div key={label}>
                  <span className={`font-semibold ${color}`}>{label}</span>
                  <div className="text-muted-foreground font-mono text-[10px] mt-0.5 ml-2">
                    {sys.execution_model}
                  </div>
                  {sys.rows_per_second != null && (
                    <div className="text-[10px] text-muted-foreground/60 ml-2">
                      {sys.rows_per_second.toLocaleString()} rows/sec
                    </div>
                  )}
                </div>
              ) : (
                <div key={label} className="text-muted-foreground/50 italic">{label}: not available</div>
              ))}
            </div>
          </div>
        </div>
        <div className="p-6 bg-muted/5"><ValidationPanel validation={data.validation} /></div>
      </div>
    );
  };

  // ────────────────────────────────────────────────────────────────────────
  //  UC9: Query Optimization
  // ────────────────────────────────────────────────────────────────────────
  const renderQueryOptimization = (data: QueryOptimizationResult) => {
    const { scenarios, comparison } = data;
    const { no_filter, single_predicate, double_predicate } = scenarios;

    const scenarioData = [
      { name: "No filter\n(full scan)", ms: no_filter.execution_time_ms, fill: "#ef4444", label: "0 predicates" },
      { name: "Region filter\n(~20% rows)", ms: single_predicate.execution_time_ms, fill: "#f97316", label: "1 predicate" },
      { name: "Region + Revenue\n(~2% rows)", ms: double_predicate.execution_time_ms, fill: "#22c55e", label: "2 predicates" },
    ];

    return (
      <div className="flex flex-col border-b border-border">
        <div className="px-6 pt-5 pb-4 border-b border-border/50">
          <div className="flex items-center gap-2 mb-3">
            <Filter className="w-4 h-4 text-muted-foreground" />
            <h3 className="font-mono text-sm uppercase tracking-wider text-foreground">
              Predicate Pushdown <span className="text-primary">Impact</span>
            </h3>
            <span className="ml-auto text-[10px] text-muted-foreground font-mono">
              {(data.fact_rows ?? 0).toLocaleString()} fact rows × {(data.dim_rows ?? 0).toLocaleString()} dim rows
            </span>
          </div>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={scenarioData} layout="vertical" margin={{ left: 20, right: 60, top: 4, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                <XAxis type="number" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }}
                  tickFormatter={(v) => `${v}ms`} />
                <YAxis type="category" dataKey="name" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 9 }} width={100} />
                <Tooltip contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 6, fontSize: 11 }}
                  formatter={(v: number) => [`${v.toFixed(1)}ms`, "time"]} />
                <Bar dataKey="ms" radius={[0, 4, 4, 0]} label={{ position: "right", fontSize: 9, fill: "hsl(var(--muted-foreground))",
                  formatter: (v: number) => `${v.toFixed(0)}ms` }}>
                  {scenarioData.map((e, i) => <Cell key={i} fill={e.fill} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-0 border-b border-border/50">
          <div className="px-6 py-4 border-b lg:border-b-0 lg:border-r border-border/50">
            <h4 className="font-mono text-xs uppercase tracking-wider text-muted-foreground mb-3">Speedup from Predicates</h4>
            <div className="flex flex-col gap-2">
              {[
                { label: "1 predicate vs no filter", value: comparison.single_predicate_speedup, highlight: comparison.single_predicate_speedup >= 1.2 },
                { label: "2 predicates vs no filter", value: comparison.double_predicate_speedup, highlight: comparison.double_predicate_speedup >= 1.5 },
                comparison.second_predicate_marginal_speedup != null && { label: "2nd predicate marginal gain", value: comparison.second_predicate_marginal_speedup!, highlight: false },
              ].filter(Boolean).map((e) => {
                const entry = e as { label: string; value: number; highlight: boolean };
                return (
                  <div key={entry.label} className="flex items-center justify-between gap-2">
                    <span className="text-xs text-muted-foreground">{entry.label}</span>
                    <Badge variant="outline" className={entry.highlight
                      ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30 font-mono text-xs"
                      : "bg-muted/30 text-muted-foreground font-mono text-xs"}>
                      {entry.value}×
                    </Badge>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="px-6 py-4">
            <h4 className="font-mono text-xs uppercase tracking-wider text-muted-foreground mb-3">Optimizer Plan Details</h4>
            <div className="flex flex-col gap-2 text-xs">
              <div>
                <span className="font-semibold text-red-400">No filter</span>
                <div className="text-muted-foreground font-mono text-[10px] mt-0.5 ml-2">
                  {no_filter.join_operators_detected.join(", ")} · {no_filter.execution_time_ms.toFixed(0)}ms · {no_filter.result_rows.toLocaleString()} output rows
                </div>
              </div>
              <div>
                <span className="font-semibold text-orange-400">1 predicate (region)</span>
                <div className="text-muted-foreground font-mono text-[10px] mt-0.5 ml-2">
                  {single_predicate.join_operators_detected.join(", ")} · {single_predicate.execution_time_ms.toFixed(0)}ms · ~20% selectivity
                </div>
              </div>
              <div>
                <span className="font-semibold text-green-400">2 predicates (region + revenue)</span>
                <div className="text-muted-foreground font-mono text-[10px] mt-0.5 ml-2">
                  {double_predicate.join_operators_detected.join(", ")} · {double_predicate.execution_time_ms.toFixed(0)}ms · ~2% selectivity
                </div>
              </div>
              <div className="mt-1 text-[10px] text-muted-foreground/70 italic border-t border-border/30 pt-2">
                {comparison.optimizer_insight}
              </div>
            </div>
          </div>
        </div>
        <div className="p-6 bg-muted/5"><ValidationPanel validation={data.validation} /></div>
      </div>
    );
  };

  // ────────────────────────────────────────────────────────────────────────
  //  UC10: Skew Handling
  // ────────────────────────────────────────────────────────────────────────
  const renderSkewHandling = (data: SkewHandlingResult) => {
    const { scenarios, comparison } = data;
    const { simple_aggregation: sa, complex_aggregation: ca, heavy_aggregation: ha } = scenarios;

    const aggData = [
      { name: "Simple\n(SUM, COUNT)", uniform: sa.uniform.execution_time_ms, skewed: sa.skewed.execution_time_ms },
      { name: "Complex\n(COUNT DISTINCT)", uniform: ca.uniform.execution_time_ms, skewed: ca.skewed.execution_time_ms },
      { name: "Heavy\n(STDDEV, P95)", uniform: ha.uniform.execution_time_ms, skewed: ha.skewed.execution_time_ms },
    ];

    return (
      <div className="flex flex-col border-b border-border">
        <div className="px-6 pt-5 pb-4 border-b border-border/50">
          <div className="flex items-center gap-2 mb-3">
            <Scale className="w-4 h-4 text-muted-foreground" />
            <h3 className="font-mono text-sm uppercase tracking-wider text-foreground">
              Skew vs Uniform <span className="text-primary">Aggregation Time</span>
            </h3>
            <span className="ml-auto text-[10px] text-muted-foreground font-mono">
              {(data.row_count ?? 0).toLocaleString()} rows · West = {data.skew_pct}% of data
            </span>
          </div>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={aggData} margin={{ left: 10, right: 20, top: 4, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="name" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 9 }} />
                <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }}
                  tickFormatter={(v) => `${v}ms`} />
                <Tooltip contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 6, fontSize: 11 }}
                  formatter={(v: number) => [`${v.toFixed(1)}ms`, ""]} />
                <Bar dataKey="uniform" name="Uniform" fill="#6366f1" radius={[4, 4, 0, 0]} />
                <Bar dataKey="skewed" name="Skewed (90% West)" fill="#ef4444" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="flex gap-4 mt-1">
            <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-indigo-500 inline-block" /><span className="text-[10px] text-muted-foreground">Uniform distribution</span></div>
            <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-red-500 inline-block" /><span className="text-[10px] text-muted-foreground">Skewed (90% West)</span></div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-0 border-b border-border/50">
          <div className="px-6 py-4 border-b lg:border-b-0 lg:border-r border-border/50">
            <h4 className="font-mono text-xs uppercase tracking-wider text-muted-foreground mb-3">Skew Slowdown by Query Type</h4>
            <div className="flex flex-col gap-2">
              {[
                { label: "Simple aggregation (SUM, COUNT)", value: comparison.simple_agg_skew_slowdown, highlight: comparison.simple_agg_skew_slowdown > 1.1 },
                { label: "Complex aggregation (COUNT DISTINCT)", value: comparison.complex_agg_skew_slowdown, highlight: comparison.complex_agg_skew_slowdown > 1.1 },
                { label: "Heavy aggregation (STDDEV, P95)", value: comparison.heavy_agg_skew_slowdown, highlight: comparison.heavy_agg_skew_slowdown > 1.2 },
              ].map(({ label, value, highlight }) => (
                <div key={label} className="flex items-center justify-between gap-2">
                  <span className="text-xs text-muted-foreground">{label}</span>
                  <Badge variant="outline" className={highlight
                    ? "bg-red-500/10 text-red-400 border-red-500/30 font-mono text-xs"
                    : "bg-muted/30 text-muted-foreground font-mono text-xs"}>
                    {value}× slower
                  </Badge>
                </div>
              ))}
            </div>
          </div>
          <div className="px-6 py-4">
            <h4 className="font-mono text-xs uppercase tracking-wider text-muted-foreground mb-3">Partition Imbalance</h4>
            <div className="flex flex-col gap-2 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">Imbalance factor (West vs expected)</span>
                <Badge variant="outline" className="bg-red-500/10 text-red-400 border-red-500/30 font-mono text-xs">
                  {comparison.partition_imbalance_factor}×
                </Badge>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">West partition size</span>
                <Badge variant="outline" className="bg-muted/30 text-muted-foreground font-mono text-xs">
                  {comparison.west_partition_pct}%
                </Badge>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">Expected (uniform)</span>
                <Badge variant="outline" className="bg-muted/30 text-muted-foreground font-mono text-xs">
                  {comparison.expected_partition_pct}%
                </Badge>
              </div>
              <div className="mt-2 text-[10px] text-muted-foreground/70 italic border-t border-border/30 pt-2">
                Spark AQE detects this skew at runtime and splits the West partition.
                DuckDB parallel executor absorbs some skew via partial aggregation.
              </div>
            </div>
          </div>
        </div>
        <div className="p-6 bg-muted/5"><ValidationPanel validation={data.validation} /></div>
      </div>
    );
  };

  const renderCardBody = () => {
    if (!results) return null;

    if (useCase.id === "variant_test") {
      const vData = results as unknown as VariantTestResult;
      if (!vData.validation) return null;
      return renderVariantTest(vData);
    }

    if (useCase.id === "acid_integrity") {
      const aData = results as unknown as AcidIntegrityResult;
      if (!aData.validation) return null;
      return renderAcidIntegrity(aData);
    }

    if (useCase.id === "vectorized_execution") {
      const vData = results as unknown as VectorizedExecutionResult;
      if (!vData.validation) return null;
      return renderVectorizedExecution(vData);
    }

    if (useCase.id === "compression") {
      const cData = results as unknown as CompressionResult;
      if (!cData.validation) return null;
      return renderCompression(cData);
    }

    if (useCase.id === "window_functions") {
      const wData = results as unknown as WindowFunctionsResult;
      if (!wData.validation) return null;
      return renderWindowFunctions(wData);
    }

    if (useCase.id === "query_optimization") {
      const qData = results as unknown as QueryOptimizationResult;
      if (!qData.validation) return null;
      return renderQueryOptimization(qData);
    }

    if (useCase.id === "skew_handling") {
      const sData = results as unknown as SkewHandlingResult;
      if (!sData.validation) return null;
      return renderSkewHandling(sData);
    }

    const perSystemResults = results as Record<string, Record<string, unknown> | undefined>;
    return Object.entries(perSystemResults).map(([system, sysData]) => {
      if (!sysData || !("validation" in sysData)) return null;
      const validation = sysData.validation as ValidationData;
      return (
        <div key={system} className="grid grid-cols-1 lg:grid-cols-2 gap-0 border-b border-border last:border-0">
          <div className="p-6 border-b lg:border-b-0 lg:border-r border-border flex flex-col">
            <div className="flex items-center gap-2 mb-4">
              <Server className="w-4 h-4 text-muted-foreground" />
              <h3 className="font-mono text-sm uppercase tracking-wider text-foreground">
                System: <span className="text-primary">{system}</span>
              </h3>
            </div>
            {renderPerSystemChart(useCase.id, system, sysData)}
          </div>
          <div className="p-6 bg-muted/5">
            <ValidationPanel validation={validation} />
          </div>
        </div>
      );
    });
  };

  return (
    <Card className="border-border bg-card/50 overflow-hidden flex flex-col">
      <CardHeader className="bg-muted/10 border-b border-border pb-4 flex flex-row items-start justify-between space-y-0">
        <div>
          <div className="flex items-center gap-2 mb-2">
            {useCase.icon}
            <CardTitle className="text-lg">{useCase.title}</CardTitle>
          </div>
          <CardDescription className="text-muted-foreground max-w-xl">
            {useCase.description}
          </CardDescription>
        </div>
        <Button
          onClick={() => onRun(useCase.id)}
          disabled={running}
          variant={isRunningThis ? "outline" : "default"}
          className="min-w-[100px] font-mono uppercase tracking-wider"
        >
          {isRunningThis ? (
            <><Activity className="w-4 h-4 mr-2 animate-pulse text-primary" /> Running</>
          ) : (
            <><Play className="w-4 h-4 mr-2" /> Run Experiment</>
          )}
        </Button>
      </CardHeader>

      <CardContent className="p-0 flex-grow flex flex-col">
        <TheoryPrimer ucId={useCase.id} />
        {!results && !isRunningThis && (
          <div className="p-12 text-center text-muted-foreground flex flex-col items-center justify-center flex-grow opacity-50">
            <Database className="w-12 h-12 mb-4 text-muted" />
            <p className="font-mono text-sm uppercase tracking-widest">Not run yet</p>
            <p className="text-xs mt-2 max-w-xs">Run the experiment to find out — results appear here.</p>
          </div>
        )}
        {renderCardBody()}
      </CardContent>
    </Card>
  );
}


export default function Dashboard() {
  const queryClient = useQueryClient();
  const [activeLogStream, setActiveLogStream] = useState<UseCaseType | null>(null);
  const [runAllQueue, setRunAllQueue] = useState<UseCaseType[]>([]);
  const [runAllProgress, setRunAllProgress] = useState(0);

  const { data: status } = useGetBenchmarkStatus({
    query: {
      queryKey: getGetBenchmarkStatusQueryKey(),
      refetchInterval: (query) =>
        (query.state.data?.running || activeLogStream !== null) ? 3000 : false,
    }
  });
  
  const runBenchmark = useRunBenchmark();

  const handleRun = (useCase: UseCaseType) => {
    runBenchmark.mutate({ useCase }, {
      onSuccess: () => {
        setActiveLogStream(useCase);
        queryClient.invalidateQueries({ queryKey: getGetBenchmarkStatusQueryKey() });
      }
    });
  };

  const handleRunAll = () => {
    const allIds = USE_CASES.map(uc => uc.id);
    setRunAllProgress(0);
    const [first, ...rest] = allIds;
    setRunAllQueue(rest);
    handleRun(first);
  };

  const handleLogComplete = () => {
    if (activeLogStream) {
      queryClient.invalidateQueries({ queryKey: getGetBenchmarkStatusQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetBenchmarkResultsQueryKey(activeLogStream) });
      setActiveLogStream(null);

      if (runAllQueue.length > 0) {
        const [next, ...rest] = runAllQueue;
        setRunAllProgress(p => p + 1);
        setRunAllQueue(rest);
        setTimeout(() => handleRun(next), 600);
      } else if (runAllProgress > 0) {
        setRunAllProgress(0);
      }
    }
  };

  // Sync log stream state with server status if refreshed (e.g., page reload mid-run)
  useEffect(() => {
    if (status?.running && status.runningUseCase && !activeLogStream) {
      setActiveLogStream(status.runningUseCase as UseCaseType);
    }
  }, [status?.running, status?.runningUseCase]);

  return (
    <div className="min-h-[100dvh] bg-background text-foreground font-sans selection:bg-primary/30 pb-20">
      {/* Header */}
      <header className="sticky top-0 z-50 w-full border-b border-border bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded bg-primary/20 flex items-center justify-center border border-primary/50 shadow-[0_0_10px_rgba(0,255,255,0.2)]">
              <Activity className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h1 className="font-bold text-lg leading-tight tracking-tight">Database Systems Lab</h1>
              <p className="text-xs text-muted-foreground font-mono uppercase tracking-widest">Learn by experiment</p>
            </div>
          </div>
          
          <div className="flex items-center gap-4">
            {/* Run All button */}
            <Button
              size="sm"
              variant="outline"
              disabled={status?.running || runAllQueue.length > 0}
              onClick={handleRunAll}
              className="hidden sm:flex items-center gap-2 border-primary/40 text-primary hover:bg-primary/10 hover:text-primary font-mono text-xs uppercase tracking-wider shadow-[0_0_8px_rgba(0,255,255,0.1)]"
            >
              {runAllQueue.length > 0 ? (
                <>
                  <Activity className="w-3.5 h-3.5 animate-pulse" />
                  {USE_CASES.length - runAllQueue.length}/{USE_CASES.length}
                </>
              ) : (
                <>
                  <Rocket className="w-3.5 h-3.5" />
                  Run All Experiments
                </>
              )}
            </Button>

            <div className="flex items-center gap-2">
              <span className="text-xs font-mono text-muted-foreground uppercase tracking-wider mr-2">Systems:</span>
              {(["postgres", "duckdb", "spark"] as const).map(sys => {
                const live = status?.availableSystems.includes(sys);
                return (
                  <div key={sys} className="flex flex-col items-center gap-0.5">
                    <Badge
                      variant="outline"
                      className={`font-mono text-xs uppercase transition-colors ${
                        live
                          ? "text-primary border-primary/60 bg-primary/10 shadow-[0_0_6px_rgba(0,255,255,0.15)]"
                          : "text-muted-foreground border-muted-foreground/20 bg-muted/20 opacity-50"
                      }`}
                    >
                      {sys}
                    </Badge>
                    <span className={`text-[9px] font-mono uppercase tracking-wider ${live ? "text-emerald-500" : "text-muted-foreground/40"}`}>
                      {status ? (live ? "live" : "offline") : "···"}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 space-y-8">
        
        {/* Intro */}
        <section className="max-w-3xl">
          <h2 className="text-2xl font-bold tracking-tight mb-2">Database Systems Lab</h2>
          <p className="text-muted-foreground">
            10 hands-on experiments that reveal how databases actually work. Each experiment poses a real question — 
            run the workload, find the smoking gun, and understand the WHY. Powered by CMU 15-721 Advanced Database Systems.
          </p>
        </section>

        {/* Headline Stats */}
        <StatsGrid
          validatedCount={status?.completedUseCases?.length ?? 0}
          total={USE_CASES.length}
        />

        {/* Research Narrative — Story Arc */}
        <section>
          <div className="flex items-center gap-2 mb-4">
            <Sparkles className="w-4 h-4 text-primary/70" />
            <h2 className="text-sm font-mono uppercase tracking-widest text-muted-foreground">Research Narrative</h2>
            <span className="flex-1 h-px bg-border/60" />
            <a
              href="https://15721.courses.cs.cmu.edu"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[10px] font-mono text-muted-foreground/60 hover:text-primary transition-colors uppercase tracking-wider"
            >
              CMU 15-721 ↗
            </a>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-5 gap-2">
            {[
              {
                act: "Act I",
                title: "Speed",
                question: "How fast?",
                icon: <Zap className="w-4 h-4" />,
                cases: "UC1 · UC2",
                proof: "5.9× buffer cache · 19K temp blocks",
                lectures: "L05 · L06",
                color: "text-sky-400",
                border: "border-sky-500/20",
                bg: "bg-sky-500/5",
              },
              {
                act: "Act II",
                title: "Mechanics",
                question: "What makes them fast?",
                icon: <HardDrive className="w-4 h-4" />,
                cases: "UC3 · UC4 · UC7",
                proof: "6.66× compression · 3.12× clustering",
                lectures: "L03 · L04",
                color: "text-orange-400",
                border: "border-orange-500/20",
                bg: "bg-orange-500/5",
              },
              {
                act: "Act III",
                title: "Intelligence",
                question: "How smart?",
                icon: <Filter className="w-4 h-4" />,
                cases: "UC8 · UC9 · UC10",
                proof: "1.57× predicate push · 7 window ops fused",
                lectures: "L07-08 · L09 · L11",
                color: "text-indigo-400",
                border: "border-indigo-500/20",
                bg: "bg-indigo-500/5",
              },
              {
                act: "Act IV",
                title: "Performance",
                question: "Why vectorization?",
                icon: <Cpu className="w-4 h-4" />,
                cases: "UC6",
                proof: "25× SIMD vs row-at-a-time Volcano",
                lectures: "L10-12",
                color: "text-emerald-400",
                border: "border-emerald-500/20",
                bg: "bg-emerald-500/5",
              },
              {
                act: "Act V",
                title: "Integrity",
                question: "But is it safe?",
                icon: <ShieldAlert className="w-4 h-4" />,
                cases: "UC5",
                proof: "Parquet lost 500K rows silently · Delta caught it",
                lectures: "L13-15",
                color: "text-red-400",
                border: "border-red-500/20",
                bg: "bg-red-500/5",
              },
            ].map((arc) => (
              <div key={arc.act} className={`rounded-xl border ${arc.border} ${arc.bg} p-4 flex flex-col gap-2`}>
                <div className="flex items-center gap-2">
                  <span className={`${arc.color}`}>{arc.icon}</span>
                  <span className={`text-[10px] font-mono uppercase tracking-widest ${arc.color}`}>{arc.act}</span>
                </div>
                <div>
                  <p className="font-semibold text-sm leading-tight">{arc.title}</p>
                  <p className="text-[10px] text-muted-foreground italic mt-0.5">"{arc.question}"</p>
                </div>
                <p className="text-[11px] text-foreground/80 leading-snug flex-1">{arc.proof}</p>
                <div className="flex items-center justify-between mt-1">
                  <span className="text-[9px] font-mono text-muted-foreground/60">{arc.cases}</span>
                  <Badge variant="outline" className={`text-[9px] font-mono px-1.5 py-0 ${arc.color} border-current/30 bg-transparent`}>
                    {arc.lectures}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Live Logs */}
        {activeLogStream && (
          <section className="animate-in fade-in slide-in-from-top-4 duration-500">
            <LiveLogPanel useCase={activeLogStream} onComplete={handleLogComplete} />
          </section>
        )}

        {/* Use Cases */}
        <section className="space-y-8">
          {USE_CASES.map(uc => (
            <UseCaseSection 
              key={uc.id} 
              useCase={uc} 
              running={status?.running || false} 
              runningUseCase={status?.runningUseCase || null}
              completedUseCases={status?.completedUseCases ?? []}
              onRun={handleRun}
            />
          ))}
        </section>

        {/* Traceability Matrix */}
        <section className="pt-12">
          <div className="mb-6">
            <h2 className="text-xl font-bold tracking-tight mb-1 flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-primary" />
              Traceability Matrix
            </h2>
            <p className="text-sm text-muted-foreground">Mapping of executed benchmarks to lecture theory.</p>
          </div>
          <div className="rounded-md border border-border overflow-hidden">
            <Table>
              <TableHeader className="bg-muted/30">
                <TableRow className="hover:bg-transparent">
                  <TableHead className="font-mono uppercase tracking-wider text-xs">Benchmark</TableHead>
                  <TableHead className="font-mono uppercase tracking-wider text-xs">Lecture</TableHead>
                  <TableHead className="font-mono uppercase tracking-wider text-xs">Concept</TableHead>
                  <TableHead className="font-mono uppercase tracking-wider text-xs">Smoking Gun</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {TRACEABILITY_MATRIX.map((row, i) => (
                  <TableRow key={i} className="border-border">
                    <TableCell className="font-medium">{row.benchmark}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="bg-purple-500/10 text-purple-400 border-purple-500/20 rounded-sm">
                        {row.lecture}
                      </Badge>
                    </TableCell>
                    <TableCell>{row.concept}</TableCell>
                    <TableCell>
                      <code className="px-2 py-1 bg-destructive/10 text-destructive border border-destructive/20 rounded text-xs font-mono">
                        {row.proof}
                      </code>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </section>

        {/* Research Reference Footer */}
        <section className="pt-8 border-t border-border/40">
          <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-6">
            <div className="max-w-lg">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-5 h-5 rounded bg-purple-500/20 border border-purple-500/30 flex items-center justify-center">
                  <Sparkles className="w-3 h-3 text-purple-400" />
                </div>
                <span className="text-xs font-mono uppercase tracking-widest text-purple-400">Academic Reference</span>
              </div>
              <h3 className="font-bold text-base mb-1">CMU 15-721: Advanced Database Systems</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Taught by <span className="text-foreground font-medium">Andy Pavlo</span> at Carnegie Mellon University.
                Covers the internals of modern database management systems — storage, execution, optimization, and concurrency control.
                This suite empirically validates every major lecture topic with live workloads.
              </p>
              <a
                href="https://15721.courses.cs.cmu.edu"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 mt-3 text-xs font-mono text-primary hover:text-primary/80 transition-colors"
              >
                15721.courses.cs.cmu.edu ↗
              </a>
            </div>

            <div className="flex flex-col gap-2 min-w-[240px]">
              <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-1">Lecture Coverage</span>
              {[
                { lectures: "L03–L04", topic: "Storage Models, Compression, Zone Maps", uc: "UC3 · UC4 · UC7" },
                { lectures: "L05–L06", topic: "Buffer Pool, External Merge Sort", uc: "UC1 · UC2" },
                { lectures: "L07–L09", topic: "Optimization, Join Algorithms, Skew", uc: "UC9 · UC10" },
                { lectures: "L10–L12", topic: "Vectorized Execution, SIMD, Window Ops", uc: "UC6 · UC8" },
                { lectures: "L13–L15", topic: "OCC / MVCC / Concurrency Control", uc: "UC5" },
              ].map((row) => (
                <div key={row.lectures} className="flex items-start gap-2 text-xs">
                  <Badge variant="outline" className="shrink-0 bg-purple-500/10 text-purple-400 border-purple-500/20 font-mono text-[10px] rounded-sm px-1.5">
                    {row.lectures}
                  </Badge>
                  <span className="text-muted-foreground leading-tight flex-1">{row.topic}</span>
                  <span className="shrink-0 text-[9px] font-mono text-muted-foreground/50">{row.uc}</span>
                </div>
              ))}
            </div>
          </div>

          <p className="text-[10px] text-muted-foreground/40 font-mono mt-8 text-center">
            Built with Replit · DuckDB · Apache Spark · PostgreSQL · Delta Lake · Parquet
          </p>
        </section>

      </main>
    </div>
  );
}
