import { parse as parseYaml } from "yaml";

export type RegexFlavor = "ecmascript" | "python";

export interface RegexTestMatch {
  start: number;
  end: number;
  match: string;
  groups: string[];
  namedGroups: Record<string, string>;
}

export interface RegexTestResult {
  [key: string]: unknown;
  matches: RegexTestMatch[];
  errors?: string[];
  warnings?: string[];
}

export function regexTest(params: { pattern: string; flags?: string; text: string }): RegexTestResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const pattern = params.pattern;
  const flags = params.flags ?? "";
  const text = params.text;

  if (pattern.length > 5000) {
    return {
      matches: [],
      errors: ["Pattern too long (max 5000 chars)."],
    };
  }

  if (text.length > 1_000_000) {
    warnings.push("Input text is very large; truncated to 1,000,000 chars for safety.");
  }
  const safeText = text.slice(0, 1_000_000);

  const dangerous = /(\.\*|\.\+)\)\+|(\.\*|\.\+)\+\+|\(\?:\.\*\)\+/.test(pattern);
  if (dangerous) {
    warnings.push(
      "Pattern may be prone to catastrophic backtracking on large inputs. Consider anchoring, avoiding nested wildcards, or using more specific character classes."
    );
  }

  let re: RegExp;
  try {
    re = new RegExp(pattern, flags);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    errors.push(msg);
    return { matches: [], errors };
  }

  const matches: RegexTestMatch[] = [];
  const maxMatches = 5000;

  // Always iterate safely. If /g isn't set, we only return the first match.
  const global = re.global;
  if (!global) {
    const m = re.exec(safeText);
    if (m) {
      matches.push({
        start: m.index,
        end: m.index + m[0].length,
        match: m[0],
        groups: (m.slice(1).filter((x) => x !== undefined) as string[]) ?? [],
        namedGroups: (m.groups ?? {}) as Record<string, string>,
      });
    }
  } else {
    let m: RegExpExecArray | null;
    let iterations = 0;
    while ((m = re.exec(safeText)) !== null) {
      matches.push({
        start: m.index,
        end: m.index + m[0].length,
        match: m[0],
        groups: (m.slice(1).filter((x) => x !== undefined) as string[]) ?? [],
        namedGroups: (m.groups ?? {}) as Record<string, string>,
      });

      // Prevent infinite loops on zero-length matches.
      if (m[0].length === 0) re.lastIndex++;
      if (++iterations >= maxMatches) {
        warnings.push(`Match limit reached (${maxMatches}). Results truncated.`);
        break;
      }
    }
  }

  const result: RegexTestResult = { matches };
  if (errors.length) result.errors = errors;
  if (warnings.length) result.warnings = warnings;
  return result;
}

export interface RegexExplainResult {
  [key: string]: unknown;
  flavor: RegexFlavor;
  flags: string;
  summary: {
    anchoredStart: boolean;
    anchoredEnd: boolean;
    hasNamedGroups: boolean;
    groupCount: number;
    alternationCount: number;
    charClassCount: number;
  };
  pitfalls: string[];
  suggestions: string[];
  explanation: string;
}

export function regexExplain(params: { pattern: string; flavor?: RegexFlavor }): RegexExplainResult {
  const flavor: RegexFlavor = params.flavor ?? "ecmascript";
  const pattern = params.pattern;

  const pitfalls: string[] = [];
  const suggestions: string[] = [];

  const anchoredStart = pattern.startsWith("^");
  const anchoredEnd = pattern.endsWith("$");
  const hasNamedGroups = /\(\?<[^>]+>/.test(pattern);
  const groupCount = (pattern.match(/\((?!\?)/g) ?? []).length + (pattern.match(/\(\?<[^>]+>/g) ?? []).length;
  const alternationCount = (pattern.match(/\|/g) ?? []).length;
  const charClassCount = (pattern.match(/\[[^\]]*]/g) ?? []).length;

  if (!anchoredStart) suggestions.push("Consider anchoring with ^ when you expect matches at line start.");
  if (!anchoredEnd) suggestions.push("Consider anchoring with $ when you expect matches at line end.");
  if (/\.\*/.test(pattern)) pitfalls.push("Contains '.*' which can be overly greedy and slow on long lines.");
  if (/(\+\)|\*\)|\?\))\+/.test(pattern)) pitfalls.push("Nested quantifiers detected; may cause catastrophic backtracking.");
  if (flavor === "python" && /\\p\{/.test(pattern)) pitfalls.push("Python's built-in re doesn't support \\p{..} properties without third-party regex module.");

  const explanation =
    [
      `Flavor: ${flavor}`,
      `Anchors: ${anchoredStart ? "starts with ^" : "no ^"}; ${anchoredEnd ? "ends with $" : "no $"}`,
      `Groups: ${groupCount} (${hasNamedGroups ? "includes named groups" : "no named groups detected"})`,
      `Character classes: ${charClassCount}`,
      `Alternations: ${alternationCount}`,
      "",
      "Note: This is a lightweight explanation (not a full regex parser). For tricky patterns, provide 2-3 positive and negative examples and use regex_suggest.",
    ].join("\n");

  return {
    flavor,
    flags: "",
    summary: {
      anchoredStart,
      anchoredEnd,
      hasNamedGroups,
      groupCount,
      alternationCount,
      charClassCount,
    },
    pitfalls,
    suggestions,
    explanation,
  };
}

export interface LogSignal {
  line: number;
  kind: "error" | "warning" | "info";
  code?: string;
  text: string;
}

export interface LogExtractSignalsResult {
  [key: string]: unknown;
  errors: LogSignal[];
  warnings: LogSignal[];
  failingTests: Array<{ line: number; text: string }>;
  keyLines: Array<{ line: number; text: string }>;
  stats: {
    totalLines: number;
    truncated: boolean;
  };
}

const DEFAULT_MAX_LOG_CHARS = 1_000_000;

export function logExtractSignals(params: { logText: string; formatHint?: "gha" | "generic" }): LogExtractSignalsResult {
  const original = params.logText ?? "";
  const truncated = original.length > DEFAULT_MAX_LOG_CHARS;
  const logText = original.slice(0, DEFAULT_MAX_LOG_CHARS);
  const lines = logText.split(/\r?\n/);

  const errors: LogSignal[] = [];
  const warnings: LogSignal[] = [];
  const failingTests: Array<{ line: number; text: string }> = [];
  const keyLines: Array<{ line: number; text: string }> = [];

  const errorRe = /\b(error|fatal|exception|segmentation fault|panic)\b/i;
  const warnRe = /\b(warn|warning|deprecated)\b/i;
  const testFailRe = /\b(FAIL|FAILED|AssertionError|E2E failure|Test failed)\b/i;

  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1;
    const t = lines[i] ?? "";
    if (!t.trim()) continue;

    if (testFailRe.test(t)) {
      failingTests.push({ line: lineNo, text: t });
      keyLines.push({ line: lineNo, text: t });
      continue;
    }

    if (errorRe.test(t) || /^##\[error]/i.test(t) || /^Error:/.test(t)) {
      errors.push({ line: lineNo, kind: "error", text: t });
      keyLines.push({ line: lineNo, text: t });
      continue;
    }

    if (warnRe.test(t) || /^##\[warning]/i.test(t)) {
      warnings.push({ line: lineNo, kind: "warning", text: t });
      if (warnings.length <= 50) keyLines.push({ line: lineNo, text: t });
      continue;
    }

    // Keep a few important-looking lines
    if (/npm ERR!|yarn error|pnpm|tsc:|pytest|jest|vitest|go test|cargo test|exit code/i.test(t)) {
      if (keyLines.length < 200) keyLines.push({ line: lineNo, text: t });
    }
  }

  return {
    errors: errors.slice(0, 200),
    warnings: warnings.slice(0, 200),
    failingTests: failingTests.slice(0, 200),
    keyLines: keyLines.slice(0, 300),
    stats: { totalLines: lines.length, truncated },
  };
}

export interface LogMatchPatternsResult {
  [key: string]: unknown;
  countsByPattern: Record<string, number>;
  samplesByPattern: Record<string, Array<{ line: number; text: string }>>;
  truncated: boolean;
}

export function logMatchPatterns(params: {
  logText: string;
  patterns: Array<{ id: string; pattern: string; flags?: string }>;
}): LogMatchPatternsResult {
  const original = params.logText ?? "";
  const truncated = original.length > DEFAULT_MAX_LOG_CHARS;
  const logText = original.slice(0, DEFAULT_MAX_LOG_CHARS);
  const lines = logText.split(/\r?\n/);

  const countsByPattern: Record<string, number> = {};
  const samplesByPattern: Record<string, Array<{ line: number; text: string }>> = {};

  for (const p of params.patterns ?? []) {
    countsByPattern[p.id] = 0;
    samplesByPattern[p.id] = [];

    let re: RegExp;
    try {
      re = new RegExp(p.pattern, p.flags ?? "");
    } catch {
      continue;
    }

    for (let i = 0; i < lines.length; i++) {
      const t = lines[i] ?? "";
      if (!t) continue;
      if (re.test(t)) {
        countsByPattern[p.id] += 1;
        if (samplesByPattern[p.id].length < 20) {
          samplesByPattern[p.id].push({ line: i + 1, text: t });
        }
      }
    }
  }

  return { countsByPattern, samplesByPattern, truncated };
}

export interface WorkflowStep {
  name?: string;
  uses?: string;
  run?: string;
  with?: Record<string, unknown>;
}

export interface WorkflowJob {
  id: string;
  name?: string;
  runsOn?: unknown;
  steps: WorkflowStep[];
  strategy?: unknown;
}

export interface WorkflowParseResult {
  [key: string]: unknown;
  provider: "github-actions" | "generic";
  jobs: WorkflowJob[];
  caches: Array<{ jobId: string; stepIndex: number; uses: string; key?: string }>;
  matrix: Array<{ jobId: string; dimensions: string[] }>;
  warnings: string[];
}

export function workflowParse(params: { workflowYaml: string; provider?: "github-actions" | "generic" }): WorkflowParseResult {
  const provider = params.provider ?? "github-actions";
  const warnings: string[] = [];

  let doc: unknown;
  try {
    doc = parseYaml(params.workflowYaml);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { provider, jobs: [], caches: [], matrix: [], warnings: [`YAML parse error: ${msg}`] };
  }

  if (typeof doc !== "object" || doc === null) {
    return { provider, jobs: [], caches: [], matrix: [], warnings: ["Workflow YAML did not parse into an object."] };
  }

  const obj = doc as Record<string, unknown>;
  const jobsObj = obj["jobs"];
  if (typeof jobsObj !== "object" || jobsObj === null) {
    return { provider, jobs: [], caches: [], matrix: [], warnings: ["No jobs found in workflow (missing `jobs`)."] };
  }

  const jobs: WorkflowJob[] = [];
  const caches: Array<{ jobId: string; stepIndex: number; uses: string; key?: string }> = [];
  const matrix: Array<{ jobId: string; dimensions: string[] }> = [];

  for (const [jobId, jobVal] of Object.entries(jobsObj as Record<string, unknown>)) {
    if (typeof jobVal !== "object" || jobVal === null) continue;
    const j = jobVal as Record<string, unknown>;
    const stepsRaw = j["steps"];
    const stepsArr = Array.isArray(stepsRaw) ? stepsRaw : [];
    const steps: WorkflowStep[] = stepsArr
      .filter((s) => typeof s === "object" && s !== null)
      .map((s) => {
        const so = s as Record<string, unknown>;
        return {
          name: typeof so["name"] === "string" ? (so["name"] as string) : undefined,
          uses: typeof so["uses"] === "string" ? (so["uses"] as string) : undefined,
          run: typeof so["run"] === "string" ? (so["run"] as string) : undefined,
          with: typeof so["with"] === "object" && so["with"] !== null ? (so["with"] as Record<string, unknown>) : undefined,
        };
      });

    const job: WorkflowJob = {
      id: jobId,
      name: typeof j["name"] === "string" ? (j["name"] as string) : undefined,
      runsOn: j["runs-on"],
      steps,
      strategy: j["strategy"],
    };
    jobs.push(job);

    steps.forEach((s, idx) => {
      if (s.uses && /^actions\/cache@/i.test(s.uses)) {
        const key = typeof s.with?.["key"] === "string" ? (s.with["key"] as string) : undefined;
        caches.push({ jobId, stepIndex: idx, uses: s.uses, key });
      }
    });

    const strategy = j["strategy"];
    if (typeof strategy === "object" && strategy !== null) {
      const strat = strategy as Record<string, unknown>;
      const matrixObj = strat["matrix"];
      if (typeof matrixObj === "object" && matrixObj !== null) {
        const dims = Object.keys(matrixObj as Record<string, unknown>);
        if (dims.length) matrix.push({ jobId, dimensions: dims });
      }
    }
  }

  if (jobs.length === 0) warnings.push("Parsed `jobs` but none were valid objects.");

  return { provider, jobs, caches, matrix, warnings };
}

export interface PipelineEstimateResult {
  [key: string]: unknown;
  estimate: {
    totalSeconds: number;
    totalMinutes: number;
    buildMinutes: number;
    jobs: Array<{ jobId: string; seconds: number; minutes: number; basis: "history" | "heuristic" }>;
  };
  biggestDrivers: Array<{ jobId: string; minutes: number; reason: string }>;
  sensitivity: Array<{ change: string; estimatedMinutesSaved: number }>;
  warnings: string[];
}

export function pipelineEstimate(params: {
  workflowModel: WorkflowParseResult;
  runHistory?: Array<{ job: string; durationSec: number }>;
  pricingModel?: "relative" | "gh-actions-minutes";
}): PipelineEstimateResult {
  const warnings: string[] = [];
  const workflow = params.workflowModel;
  const history = params.runHistory ?? [];

  const historyByJob = new Map<string, number>();
  for (const h of history) {
    if (!h?.job || !Number.isFinite(h.durationSec)) continue;
    historyByJob.set(h.job, Math.max(0, Math.floor(h.durationSec)));
  }

  const jobs = (workflow.jobs ?? []).map((j) => {
    const hist = historyByJob.get(j.id);
    if (typeof hist === "number") {
      const minutes = Math.max(0, hist / 60);
      return { jobId: j.id, seconds: hist, minutes, basis: "history" as const };
    }

    // Simple heuristic: 25s per step + add 60s if checkout, +90s if setup-node/setup-python/setup-java
    let seconds = 0;
    seconds += (j.steps?.length ?? 0) * 25;
    for (const s of j.steps ?? []) {
      const uses = (s.uses ?? "").toLowerCase();
      if (uses.startsWith("actions/checkout@")) seconds += 60;
      if (uses.startsWith("actions/setup-node@")) seconds += 90;
      if (uses.startsWith("actions/setup-python@")) seconds += 90;
      if (uses.startsWith("actions/setup-java@")) seconds += 120;
      if (uses.startsWith("actions/cache@")) seconds += 15;
    }
    seconds = Math.max(30, seconds);
    const minutes = seconds / 60;
    return { jobId: j.id, seconds, minutes, basis: "heuristic" as const };
  });

  if (jobs.length === 0) warnings.push("No jobs available in workflow model; estimate will be zero.");

  const totalSeconds = jobs.reduce((acc, j) => acc + j.seconds, 0);
  const totalMinutes = totalSeconds / 60;
  const buildMinutes = totalMinutes; // GH Actions minutes roughly sum of job minutes (ignoring concurrency discounts)

  const sorted = [...jobs].sort((a, b) => b.minutes - a.minutes).slice(0, 5);
  const biggestDrivers = sorted.map((j) => ({
    jobId: j.jobId,
    minutes: j.minutes,
    reason: j.basis === "history" ? "Based on provided run history." : "Heuristic based on step count and common setup actions.",
  }));

  const sensitivity: Array<{ change: string; estimatedMinutesSaved: number }> = [];
  if ((workflow.caches ?? []).length === 0) {
    sensitivity.push({ change: "Add dependency caching (actions/cache) for package installs", estimatedMinutesSaved: Math.min(5, totalMinutes * 0.2) });
  }
  if ((workflow.matrix ?? []).some((m) => m.dimensions.length > 0)) {
    sensitivity.push({ change: "Reduce matrix size or split smoke vs full suite", estimatedMinutesSaved: Math.min(10, totalMinutes * 0.25) });
  }

  return {
    estimate: {
      totalSeconds,
      totalMinutes,
      buildMinutes,
      jobs,
    },
    biggestDrivers,
    sensitivity,
    warnings,
  };
}

