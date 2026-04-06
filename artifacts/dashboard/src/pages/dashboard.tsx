import { useGetBenchmarkStatus, useRunBenchmark, getGetBenchmarkResultsQueryKey, getGetBenchmarkStatusQueryKey, useGetBenchmarkResults } from "@workspace/api-client-react";
import { useEffect, useState, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { Activity, Play, TerminalSquare, Database, Server, Table as TableIcon, Zap, HardDrive, CheckCircle2 } from "lucide-react";

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

type UseCaseType = "dashboards" | "complex_joins" | "variant_test" | "clustering";

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
  }
];

const TRACEABILITY_MATRIX = [
  { benchmark: "VARIANT vs STRING JSON", lecture: "Lecture 03", concept: "PAX Storage", proof: "VARIANT avoids disk_spill_bytes; STRING spills" },
  { benchmark: "Postgres CLUSTER heap", lecture: "Lecture 04", concept: "Storage Models (Clustered Index)", proof: "cluster_speedup > 3x; sequential vs random IO" },
  { benchmark: "Dashboard cold/hot cache", lecture: "Lecture 05", concept: "Buffer Pool Management", proof: "hot_speedup > 3x; OS page cache eliminates disk IO" },
  { benchmark: "Postgres join (low work_mem)", lecture: "Lecture 06", concept: "External Merge Sort", proof: "temp written=N blocks in EXPLAIN ANALYZE" },
  { benchmark: "DuckDB dashboard query", lecture: "Lecture 07", concept: "Vectorized Execution", proof: "cpu_bound_percent > 75%; SIMD column-at-a-time" },
  { benchmark: "DuckDB/Spark complex join", lecture: "Lecture 09", concept: "Join Algorithms", proof: "hash join in-memory vs broadcast shuffle vs merge join" },
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
  onRun 
}: { 
  useCase: typeof USE_CASES[0]; 
  running: boolean; 
  runningUseCase: string | null; 
  onRun: (id: UseCaseType) => void;
}) {
  const { data: results } = useGetBenchmarkResults(useCase.id, { 
    query: { 
      enabled: true,
      queryKey: getGetBenchmarkResultsQueryKey(useCase.id)
    } 
  });

  const isRunningThis = running && runningUseCase === useCase.id;
  const isRunningOther = running && runningUseCase !== useCase.id;

  const renderTimeChart = (chartData: { name: string; time: number }[], barColor: string) => (
    <div className="h-36 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chartData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
          <XAxis dataKey="name" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v: number) => `${v}s`} />
          <Tooltip
            contentStyle={{ backgroundColor: "hsl(var(--card))", borderColor: "hsl(var(--border))", borderRadius: "4px" }}
            itemStyle={{ color: "hsl(var(--foreground))" }}
            formatter={(v: number) => [`${v}s`, "Execution Time"]}
            cursor={{ fill: "hsl(var(--muted) / 0.5)" }}
          />
          <Bar dataKey="time" fill={barColor} radius={[2, 2, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );

  const renderCpuIoChart = (cpuPct: number, ioPct: number) => {
    const cpuIoData = [{ name: "CPU-bound", pct: parseFloat(cpuPct.toFixed(1)) }, { name: "IO-bound", pct: parseFloat(ioPct.toFixed(1)) }];
    return (
      <div className="h-28 w-full">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">CPU / IO Split</p>
        <ResponsiveContainer width="100%" height="80%">
          <BarChart data={cpuIoData} layout="vertical" margin={{ top: 0, right: 30, left: 0, bottom: 0 }}>
            <XAxis type="number" domain={[0, 100]} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v: number) => `${v}%`} />
            <YAxis type="category" dataKey="name" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} axisLine={false} tickLine={false} width={62} />
            <Tooltip
              contentStyle={{ backgroundColor: "hsl(var(--card))", borderColor: "hsl(var(--border))", borderRadius: "4px" }}
              formatter={(v: number) => [`${v}%`, "Share"]}
              cursor={{ fill: "hsl(var(--muted) / 0.2)" }}
            />
            <Bar dataKey="pct" fill="hsl(var(--chart-3))" radius={[0, 2, 2, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    );
  };

  const renderPerSystemChart = (useCaseId: UseCaseType, system: string, data: Record<string, unknown>) => {
    if (useCaseId === "dashboards") {
      const d = data as unknown as DashboardSystemResult;
      const cold = d.cold_hot?.cold?.time_seconds ?? 0;
      const hot = d.cold_hot?.hot?.time_seconds ?? 0;
      const speedup = d.cold_hot?.speedup;
      const chartData = [
        { name: "Cold Run", time: parseFloat(cold.toFixed(3)) },
        { name: "Hot Run", time: parseFloat(hot.toFixed(3)) },
      ];
      return (
        <div className="flex flex-col gap-3 mt-3">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Execution Time</p>
          {renderTimeChart(chartData, "hsl(var(--primary))")}
          {speedup != null && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Cache speedup:</span>
              <Badge variant="outline" className="text-emerald-400 border-emerald-500/30 text-xs font-mono">{speedup.toFixed(1)}x faster (hot)</Badge>
            </div>
          )}
          {(d.cpu_bound_percent != null) && renderCpuIoChart(d.cpu_bound_percent, d.io_bound_percent)}
        </div>
      );
    }

    if (useCaseId === "clustering") {
      const d = data as unknown as ClusteringSystemResult;
      const before = (d.unclustered ?? d.unsorted)?.total_time_seconds ?? 0;
      const after = (d.clustered ?? d.sorted)?.total_time_seconds ?? 0;
      const beforeLabel = d.unclustered ? "Unclustered" : "Unsorted";
      const afterLabel = d.clustered ? "Clustered" : "Sorted";
      const chartData = [
        { name: beforeLabel, time: parseFloat(before.toFixed(3)) },
        { name: afterLabel, time: parseFloat(after.toFixed(3)) },
      ];
      const beforeMetrics = d.unclustered ?? d.unsorted;
      return (
        <div className="flex flex-col gap-3 mt-3">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Execution Time</p>
          {renderTimeChart(chartData, "hsl(var(--chart-2))")}
          {d.speedup != null && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Cluster speedup:</span>
              <Badge variant="outline" className="text-emerald-400 border-emerald-500/30 text-xs font-mono">{d.speedup.toFixed(1)}x faster</Badge>
            </div>
          )}
          {(beforeMetrics?.cpu_bound_percent != null) && renderCpuIoChart(beforeMetrics.cpu_bound_percent, beforeMetrics.io_bound_percent)}
        </div>
      );
    }

    if (useCaseId === "complex_joins") {
      const d = data as unknown as ComplexJoinsSystemResult;
      let chartData: { name: string; time: number }[] = [];
      let firstResult: WorkMemResult | undefined;
      if (d.results_by_work_mem) {
        const entries = Object.entries(d.results_by_work_mem);
        chartData = entries.map(([mem, res]) => ({
          name: mem,
          time: parseFloat((res.total_time_seconds ?? 0).toFixed(3)),
        }));
        firstResult = entries[0]?.[1];
      } else if (d.total_time_seconds != null) {
        chartData = [{ name: system, time: parseFloat(d.total_time_seconds.toFixed(3)) }];
      }
      return (
        <div className="flex flex-col gap-3 mt-3">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Execution Time by work_mem</p>
          {chartData.length > 0 && renderTimeChart(chartData, "hsl(var(--chart-4))")}
          {(firstResult?.cpu_bound_percent != null) && renderCpuIoChart(firstResult.cpu_bound_percent, firstResult.io_bound_percent)}
        </div>
      );
    }

    return null;
  };

  const renderVariantTest = (data: VariantTestResult) => {
    const chartData = [
      { name: "STRING JSON", time: parseFloat((data.string_json.execution_time_seconds ?? 0).toFixed(3)) },
      { name: "VARIANT", time: parseFloat((data.variant_shredded.execution_time_seconds ?? 0).toFixed(3)) },
    ];
    return (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-0 border-b border-border">
        <div className="p-6 border-b lg:border-b-0 lg:border-r border-border flex flex-col">
          <div className="flex items-center gap-2 mb-4">
            <Server className="w-4 h-4 text-muted-foreground" />
            <h3 className="font-mono text-sm uppercase tracking-wider text-foreground">
              Spark: <span className="text-primary">STRING vs VARIANT</span>
            </h3>
          </div>
          <div className="h-48 w-full mt-4">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="name" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }} axisLine={false} tickLine={false} tickFormatter={(v: number) => `${v}s`} />
                <Tooltip
                  contentStyle={{ backgroundColor: "hsl(var(--card))", borderColor: "hsl(var(--border))", borderRadius: "4px" }}
                  itemStyle={{ color: "hsl(var(--foreground))" }}
                  formatter={(v: number) => [`${v}s`, "Time"]}
                  cursor={{ fill: "hsl(var(--muted) / 0.5)" }}
                />
                <Bar dataKey="time" fill="hsl(var(--chart-3))" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          {data.proof && (
            <div className="mt-4 text-xs text-muted-foreground font-mono">
              Speedup: <span className="text-primary">{data.proof.speedup}x</span>
              {" | "}Memory savings: <span className="text-primary">{data.proof.memory_savings_mb} MB</span>
            </div>
          )}
        </div>
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
  const { data: status } = useGetBenchmarkStatus({
    query: {
      queryKey: getGetBenchmarkStatusQueryKey(),
      refetchInterval: (query) => query.state.data?.running ? 3000 : false
    }
  });
  
  const runBenchmark = useRunBenchmark();
  const [activeLogStream, setActiveLogStream] = useState<UseCaseType | null>(null);

  const handleRun = (useCase: UseCaseType) => {
    runBenchmark.mutate({ useCase }, {
      onSuccess: () => {
        setActiveLogStream(useCase);
      }
    });
  };

  const handleLogComplete = () => {
    if (activeLogStream) {
      queryClient.invalidateQueries({ queryKey: getGetBenchmarkResultsQueryKey(activeLogStream) });
      setActiveLogStream(null);
    }
  };

  // Sync log stream state with server status if refreshed
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
              <span className="text-xs font-mono text-muted-foreground uppercase tracking-wider mr-2">Available Systems:</span>
              {status?.availableSystems.map(sys => (
                <Badge key={sys} variant="outline" className="font-mono text-xs uppercase bg-secondary/50">
                  {sys}
                </Badge>
              )) || <span className="text-xs text-muted-foreground font-mono">Scanning...</span>}
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
