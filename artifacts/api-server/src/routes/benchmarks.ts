import { Router, type IRouter } from "express";
import { spawn, execSync, type ChildProcess } from "child_process";
import fs from "fs";
import net from "net";
import path from "path";
import { fileURLToPath } from "url";
import {
  GetBenchmarkStatusResponse,
  GetBenchmarkResultsParams,
  GetBenchmarkResultsResponse,
  RunBenchmarkParams,
  RunBenchmarkResponse,
} from "@workspace/api-zod";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// ------------------------------------------------------------------
// State (in-process, single-worker)
// ------------------------------------------------------------------

type UseCase = "dashboards" | "complex_joins" | "variant_test" | "clustering";

const USE_CASE_FILES: Record<UseCase, string> = {
  dashboards: "use_case_1_dashboards.json",
  complex_joins: "use_case_2_complex_joins.json",
  variant_test: "use_case_3_variant_acid_test.json",
  clustering: "use_case_4_clustering.json",
};

const USE_CASE_SCRIPTS: Record<UseCase, string> = {
  dashboards: "benchmarks/benchmark_dashboards.py",
  complex_joins: "benchmarks/benchmark_complex_joins.py",
  variant_test: "benchmarks/benchmark_variant_test.py",
  clustering: "benchmarks/benchmark_clustering.py",
};

// Resolve benchmark directory relative to the compiled file location.
// dist/index.mjs → artifacts/api-server/dist/ → ../../.. = workspace root
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE_ROOT = path.resolve(__dirname, "../../..");
const BENCHMARK_DIR = path.join(WORKSPACE_ROOT, "olap-benchmark");
const RESULTS_DIR = path.join(BENCHMARK_DIR, "results");

// Running state
let runningUseCase: UseCase | null = null;
let runningProcess: ChildProcess | null = null;

// SSE log buffers: useCase → lines
const logBuffers: Record<string, string[]> = {};
const logSubscribers: Record<string, Set<(line: string) => void>> = {};

function broadcast(useCase: string, line: string) {
  logBuffers[useCase] = logBuffers[useCase] ?? [];
  logBuffers[useCase].push(line);
  const subs = logSubscribers[useCase];
  if (subs) {
    for (const fn of subs) fn(line);
  }
}

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

function getCompletedUseCases(): string[] {
  try {
    if (!fs.existsSync(RESULTS_DIR)) return [];
    return Object.entries(USE_CASE_FILES)
      .filter(([, file]) => fs.existsSync(path.join(RESULTS_DIR, file)))
      .map(([useCase]) => useCase);
  } catch {
    return [];
  }
}

// ------------------------------------------------------------------
// System availability — cached async probe
// ------------------------------------------------------------------

let systemsCache: string[] | null = null;
let systemsCacheTime = 0;
const SYSTEMS_CACHE_TTL_MS = 60_000; // re-probe at most once per minute

function tcpPing(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    socket.setTimeout(timeoutMs);
    socket.on("connect", () => { socket.destroy(); resolve(true); });
    socket.on("error", () => resolve(false));
    socket.on("timeout", () => { socket.destroy(); resolve(false); });
  });
}

async function probeSystems(): Promise<string[]> {
  const systems: string[] = ["duckdb"]; // always available — no server needed

  // Postgres: real TCP check on configured host/port
  const pgHost = process.env.POSTGRES_HOST ?? "localhost";
  const pgPort = parseInt(process.env.POSTGRES_PORT ?? "5432", 10);
  if (await tcpPing(pgHost, pgPort, 2000)) {
    systems.push("postgres");
  }

  // Spark: verify PySpark is actually importable in the Python runtime
  try {
    execSync("python3 -c 'import pyspark'", { timeout: 5000, stdio: "ignore" });
    systems.push("spark");
  } catch {
    // PySpark not installed or broken
  }

  return systems;
}

async function getAvailableSystems(): Promise<string[]> {
  const now = Date.now();
  if (systemsCache && now - systemsCacheTime < SYSTEMS_CACHE_TTL_MS) {
    return systemsCache;
  }
  systemsCache = await probeSystems();
  systemsCacheTime = now;
  return systemsCache;
}

// ------------------------------------------------------------------
// GET /benchmarks/status
// ------------------------------------------------------------------

router.get("/benchmarks/status", async (_req, res): Promise<void> => {
  const data = GetBenchmarkStatusResponse.parse({
    running: runningUseCase !== null,
    runningUseCase: runningUseCase,
    completedUseCases: getCompletedUseCases(),
    availableSystems: await getAvailableSystems(),
  });
  res.json(data);
});

// ------------------------------------------------------------------
// GET /benchmarks/results/:useCase
// ------------------------------------------------------------------

router.get("/benchmarks/results/:useCase", async (req, res): Promise<void> => {
  const params = GetBenchmarkResultsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const useCase = params.data.useCase as UseCase;
  const filePath = path.join(RESULTS_DIR, USE_CASE_FILES[useCase]);

  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: `No results found for use case: ${useCase}` });
    return;
  }

  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const data = JSON.parse(raw);
    res.json(GetBenchmarkResultsResponse.parse(data));
  } catch (err) {
    req.log.error({ err, useCase }, "Failed to read results file");
    res.status(500).json({ error: "Failed to read results file" });
  }
});

// ------------------------------------------------------------------
// POST /benchmarks/run/:useCase
// ------------------------------------------------------------------

router.post("/benchmarks/run/:useCase", async (req, res): Promise<void> => {
  const params = RunBenchmarkParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  if (runningUseCase !== null) {
    res.status(409).json({
      error: `Benchmark already running: ${runningUseCase}. Wait for it to complete.`,
    });
    return;
  }

  const useCase = params.data.useCase as UseCase;
  const scriptPath = path.join(BENCHMARK_DIR, USE_CASE_SCRIPTS[useCase]);

  if (!fs.existsSync(scriptPath)) {
    res.status(400).json({ error: `Script not found: ${USE_CASE_SCRIPTS[useCase]}` });
    return;
  }

  // Clear old log buffer for this use case
  logBuffers[useCase] = [];

  // Spawn Python
  const proc = spawn("python3", [scriptPath], {
    cwd: BENCHMARK_DIR,
    env: { ...process.env },
    stdio: ["ignore", "pipe", "pipe"],
  });

  runningUseCase = useCase;
  runningProcess = proc;

  req.log.info({ useCase, pid: proc.pid }, "Benchmark started");

  proc.stdout?.on("data", (data: Buffer) => {
    const lines = data.toString().split("\n");
    for (const line of lines) {
      if (line.trim()) broadcast(useCase, line);
    }
  });

  proc.stderr?.on("data", (data: Buffer) => {
    const lines = data.toString().split("\n");
    for (const line of lines) {
      if (line.trim()) broadcast(useCase, `[stderr] ${line}`);
    }
  });

  proc.on("close", (code) => {
    logger.info({ useCase, exitCode: code }, "Benchmark process exited");
    broadcast(useCase, `[DONE]`);
    runningUseCase = null;
    runningProcess = null;
  });

  proc.on("error", (err) => {
    logger.error({ err, useCase }, "Benchmark process error");
    broadcast(useCase, `[ERROR] ${err.message}`);
    broadcast(useCase, `[DONE]`);
    runningUseCase = null;
    runningProcess = null;
  });

  const response = RunBenchmarkResponse.parse({
    started: true,
    useCase,
    message: `Benchmark started for ${useCase}. Connect to /api/benchmarks/logs/${useCase} for live output.`,
    pid: proc.pid ?? null,
  });

  res.json(response);
});

// ------------------------------------------------------------------
// GET /benchmarks/logs/:useCase  (Server-Sent Events — manual, not in codegen)
// ------------------------------------------------------------------

router.get("/benchmarks/logs/:useCase", (req, res): void => {
  const useCase = req.params.useCase as UseCase;

  if (!USE_CASE_FILES[useCase]) {
    res.status(400).json({ error: `Unknown use case: ${useCase}` });
    return;
  }

  // SSE headers
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();

  // Send buffered lines (in case client reconnects)
  const buffer = logBuffers[useCase] ?? [];
  for (const line of buffer) {
    res.write(`data: ${line}\n\n`);
  }

  // If we already sent [DONE] in buffer, close
  if (buffer.includes("[DONE]")) {
    res.end();
    return;
  }

  // Subscribe to new lines
  logSubscribers[useCase] = logSubscribers[useCase] ?? new Set();
  const send = (line: string) => {
    res.write(`data: ${line}\n\n`);
    if (line === "[DONE]") {
      cleanup();
      res.end();
    }
  };

  logSubscribers[useCase].add(send);

  const cleanup = () => {
    logSubscribers[useCase]?.delete(send);
  };

  req.on("close", cleanup);
});

export default router;
