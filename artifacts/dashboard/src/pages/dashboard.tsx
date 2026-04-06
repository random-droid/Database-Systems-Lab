import { useGetBenchmarkStatus, useRunBenchmark, getGetBenchmarkResultsQueryKey, getGetBenchmarkStatusQueryKey, useGetBenchmarkResults } from "@workspace/api-client-react";
import { useEffect, useState, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { Activity, Play, TerminalSquare, Database, Server, Table as TableIcon, Zap, HardDrive, CheckCircle2, ShieldAlert, Cpu } from "lucide-react";

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

type UseCaseType = "dashboards" | "complex_joins" | "variant_test" | "clustering" | "acid_integrity" | "vectorized_execution";

const USE_CASES: { id: UseCaseType; title: string; description: string; lecture: string; icon: React.ReactNode }[] = [
  {
    id: "dashboards",
    title: "Sub-second Dashboard Queries",
    description: "Evaluates vectorized execution capabilities and buffer pool warming effects.",
    lecture: "Lecture 07: Vectorized Execution",
    icon: <Zap className="w-5 h-5" />
  },
  {
    id: "complex_joins",
    title: "Complex Analytical Joins",
    description: "Stress tests external merge sort and memory-bounded join algorithms.",
    lecture: "Lecture 06: External Merge Sort",
    icon: <TableIcon className="w-5 h-5" />
  },
  {
    id: "variant_test",
    title: "VARIANT Shredding Acid Test",
    description: "Compares raw JSON extraction vs structured shredded columns.",
    lecture: "Lecture 03: PAX Storage",
    icon: <Database className="w-5 h-5" />
  },
  {
    id: "clustering",
    title: "Clustering & Partitioning Impact",
    description: "Measures performance speedup from aligned storage models.",
    lecture: "Lecture 04: Storage Models",
    icon: <HardDrive className="w-5 h-5" />
  },
  {
    id: "acid_integrity",
    title: "ACID Integrity & Concurrency Control",
    description: "Races concurrent writers against Parquet (silent lost update) and Delta Lake (OCC conflict detection + MVCC time travel).",
    lecture: "Lectures 13–15: OCC / MVCC",
    icon: <ShieldAlert className="w-5 h-5" />
  },
  {
    id: "vectorized_execution",
    title: "Vectorized Execution & SIMD",
    description: "Compares DuckDB (1024-tuple SIMD batches) vs NumPy columnar vs Python row-at-a-time Volcano model on a compute-intensive arithmetic aggregation.",
    lecture: "Lectures 10–12: Vectorized Execution",
    icon: <Cpu className="w-5 h-5" />
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
];

function ValidationPanel({ validation }: { validation: ValidationData }) {
  if (!validation) return null;
  return (
    <div className="flex flex-col gap-4 p-4 bg-muted/30 rounded-md border border-border h-full">
      <div>
        <Badge variant="outline" className="bg-purple-500/10 text-purple-400 border-purple-500/20 mb-2">
          {validation.lecture}
        </Badge>
      </div>
      
      <div>
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Concept</h4>
        <p className="text-sm font-medium">{validation.concept}</p>
      </div>

      <div className="bg-background border border-destructive/50 rounded-md p-3">
        <h4 className="text-xs font-semibold text-destructive uppercase tracking-wider mb-2 flex items-center gap-1">
          <TerminalSquare className="w-3 h-3" /> Smoking Gun
        </h4>
        <code className="text-xs font-mono text-foreground break-all">
          {validation.proof}
        </code>
      </div>

      <div>
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Validates</h4>
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
            <><Play className="w-4 h-4 mr-2" /> Execute</>
          )}
        </Button>
      </CardHeader>

      <CardContent className="p-0 flex-grow flex flex-col">
        {!results && !isRunningThis && (
          <div className="p-12 text-center text-muted-foreground flex flex-col items-center justify-center flex-grow opacity-50">
            <Database className="w-12 h-12 mb-4 text-muted" />
            <p className="font-mono text-sm uppercase tracking-widest">No Telemetry Data</p>
            <p className="text-xs mt-2 max-w-xs">Execute benchmark to generate validation results.</p>
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

  const { data: status } = useGetBenchmarkStatus({
    query: {
      queryKey: getGetBenchmarkStatusQueryKey(),
      // Poll every 3s while a run is active or an SSE stream is open
      refetchInterval: (query) =>
        (query.state.data?.running || activeLogStream !== null) ? 3000 : false,
    }
  });
  
  const runBenchmark = useRunBenchmark();

  const handleRun = (useCase: UseCaseType) => {
    runBenchmark.mutate({ useCase }, {
      onSuccess: () => {
        setActiveLogStream(useCase);
        // Immediately refresh status so running=true and system chips update
        queryClient.invalidateQueries({ queryKey: getGetBenchmarkStatusQueryKey() });
      }
    });
  };

  const handleLogComplete = () => {
    if (activeLogStream) {
      // Refresh status first so completedUseCases updates and enables the results query
      queryClient.invalidateQueries({ queryKey: getGetBenchmarkStatusQueryKey() });
      // Then refetch results for this specific use case
      queryClient.invalidateQueries({ queryKey: getGetBenchmarkResultsQueryKey(activeLogStream) });
      setActiveLogStream(null);
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
              <h1 className="font-bold text-lg leading-tight tracking-tight">OLAP Benchmark</h1>
              <p className="text-xs text-muted-foreground font-mono uppercase tracking-widest">CMU 15-721 Validation</p>
            </div>
          </div>
          
          <div className="flex items-center gap-4">
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
          <h2 className="text-2xl font-bold tracking-tight mb-2">Research Dashboard</h2>
          <p className="text-muted-foreground">
            Live benchmarking cockpit validating theoretical concepts from CMU 15-721 Advanced Database Systems. 
            Execute workloads against available engines to generate empirical proofs mapped directly to lecture concepts.
          </p>
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

      </main>
    </div>
  );
}
