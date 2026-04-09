import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import chalk from "chalk";
import express, { Request, Response } from "express";
import { z } from "zod";
import {
  logExtractSignals,
  logMatchPatterns,
  pipelineEstimate,
  regexExplain,
  regexTest,
  workflowParse,
} from "./tools.js";

// ============================================================================
// Dev Logging Utilities (auto-disabled in production)
// ============================================================================

const isDev = process.env.NODE_ENV !== "production";

function timestamp(): string {
  return new Date().toLocaleTimeString("en-US", { hour12: false });
}

function formatLatency(ms: number): string {
  if (ms < 100) return chalk.green(`${ms}ms`);
  if (ms < 500) return chalk.yellow(`${ms}ms`);
  return chalk.red(`${ms}ms`);
}

function truncate(str: string, maxLen = 60): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 3) + "...";
}

function logRequest(method: string, params?: unknown): void {
  if (!isDev) return;
  const paramsStr = params ? chalk.gray(` ${truncate(JSON.stringify(params))}`) : "";
  console.log(`${chalk.gray(`[${timestamp()}]`)} ${chalk.cyan("→")} ${method}${paramsStr}`);
}

function logResponse(method: string, result: unknown, latencyMs: number): void {
  if (!isDev) return;
  const latency = formatLatency(latencyMs);
  if (method === "tools/call" && result) {
    const resultStr = typeof result === "string" ? result : JSON.stringify(result);
    console.log(`${chalk.gray(`[${timestamp()}]`)} ${chalk.green("←")} ${truncate(resultStr)} ${chalk.gray(`(${latency})`)}`);
  } else {
    console.log(`${chalk.gray(`[${timestamp()}]`)} ${chalk.green("✓")} ${method} ${chalk.gray(`(${latency})`)}`);
  }
}

function logError(method: string, error: unknown, latencyMs: number): void {
  const latency = formatLatency(latencyMs);
  let errorMsg: string;
  if (error instanceof Error) {
    errorMsg = error.message;
  } else if (typeof error === "object" && error !== null) {
    const rpcError = error as { message?: string; code?: number };
    errorMsg = rpcError.message || `Error ${rpcError.code || "unknown"}`;
  } else {
    errorMsg = String(error);
  }
  console.log(
    `${chalk.gray(`[${timestamp()}]`)} ${chalk.red("✖")} ${method} ${chalk.red(truncate(errorMsg))} ${chalk.gray(`(${latency})`)}`
  );
}

// ============================================================================
// MCP Server Setup
// ============================================================================

const server = new McpServer({
  name: "ci-log-optimizer-mcp",
  version: "0.1.0",
});

server.registerTool(
  "regex_test",
  {
    title: "Regex Test",
    description: "Test a regex against text/logs and return matches with indices and groups.",
    inputSchema: {
      pattern: z.string().min(1).describe("Regex pattern."),
      flags: z.string().optional().describe("Regex flags (e.g., 'gi')."),
      text: z.string().describe("Text/log to search in."),
    },
    outputSchema: {
      matches: z.array(
        z.object({
          start: z.number(),
          end: z.number(),
          match: z.string(),
          groups: z.array(z.string()),
          namedGroups: z.record(z.string(), z.string()),
        })
      ),
      errors: z.array(z.string()).optional(),
      warnings: z.array(z.string()).optional(),
    },
  },
  async ({ pattern, flags, text }) => {
    try {
      const output = regexTest({ pattern, flags, text });
      return {
        content: [{ type: "text", text: JSON.stringify(output) }],
        structuredContent: output,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text", text: JSON.stringify({ error: message, suggestion: "Check your pattern/flags and try again." }) }],
        isError: true,
      };
    }
  }
);

server.registerTool(
  "regex_explain",
  {
    title: "Regex Explain",
    description: "Explain a regex and highlight performance pitfalls.",
    inputSchema: {
      pattern: z.string().min(1).describe("Regex pattern to explain."),
      flavor: z.enum(["ecmascript", "python"]).optional().describe("Regex flavor assumptions (best-effort)."),
    },
    outputSchema: {
      flavor: z.enum(["ecmascript", "python"]),
      flags: z.string(),
      summary: z.object({
        anchoredStart: z.boolean(),
        anchoredEnd: z.boolean(),
        hasNamedGroups: z.boolean(),
        groupCount: z.number(),
        alternationCount: z.number(),
        charClassCount: z.number(),
      }),
      pitfalls: z.array(z.string()),
      suggestions: z.array(z.string()),
      explanation: z.string(),
    },
  },
  async ({ pattern, flavor }) => {
    try {
      const output = regexExplain({ pattern, flavor });
      return {
        content: [{ type: "text", text: JSON.stringify(output) }],
        structuredContent: output,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text", text: JSON.stringify({ error: message, suggestion: "Try a shorter pattern or specify a flavor." }) }],
        isError: true,
      };
    }
  }
);

server.registerTool(
  "log_extract_signals",
  {
    title: "Log Extract Signals",
    description: "Parse raw logs and extract structured signals (errors, warnings, stack traces, test failures).",
    inputSchema: {
      logText: z.string().describe("Raw log text."),
      formatHint: z.enum(["gha", "generic"]).optional().describe("Optional hint for log format."),
    },
    outputSchema: {
      errors: z.array(z.object({ line: z.number(), kind: z.literal("error"), code: z.string().optional(), text: z.string() })),
      warnings: z.array(z.object({ line: z.number(), kind: z.literal("warning"), code: z.string().optional(), text: z.string() })),
      failingTests: z.array(z.object({ line: z.number(), text: z.string() })),
      keyLines: z.array(z.object({ line: z.number(), text: z.string() })),
      stats: z.object({ totalLines: z.number(), truncated: z.boolean() }),
    },
  },
  async ({ logText, formatHint }) => {
    try {
      const output = logExtractSignals({ logText, formatHint });
      return {
        content: [{ type: "text", text: JSON.stringify(output) }],
        structuredContent: output,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text", text: JSON.stringify({ error: message, suggestion: "Try pasting a smaller log chunk." }) }],
        isError: true,
      };
    }
  }
);

server.registerTool(
  "log_match_patterns",
  {
    title: "Log Match Patterns",
    description: "Apply multiple regex patterns to logs and summarize frequency and top matching lines.",
    inputSchema: {
      logText: z.string().describe("Raw log text."),
      patterns: z
        .array(
          z.object({
            id: z.string().min(1).describe("Pattern identifier."),
            pattern: z.string().min(1).describe("Regex pattern."),
            flags: z.string().optional().describe("Regex flags."),
          })
        )
        .min(1)
        .describe("Patterns to apply."),
    },
    outputSchema: {
      countsByPattern: z.record(z.string(), z.number()),
      samplesByPattern: z.record(z.string(), z.array(z.object({ line: z.number(), text: z.string() }))),
      truncated: z.boolean(),
    },
  },
  async ({ logText, patterns }) => {
    try {
      const output = logMatchPatterns({ logText, patterns });
      return {
        content: [{ type: "text", text: JSON.stringify(output) }],
        structuredContent: output,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text", text: JSON.stringify({ error: message, suggestion: "Validate your patterns and try again." }) }],
        isError: true,
      };
    }
  }
);

server.registerTool(
  "workflow_parse",
  {
    title: "Workflow Parse",
    description: "Parse workflow YAML and return a normalized model of jobs/steps/matrix/caches.",
    inputSchema: {
      workflowYaml: z.string().min(1).describe("Workflow file content (YAML)."),
      provider: z.enum(["github-actions", "generic"]).optional().describe("Which CI workflow format to assume."),
    },
    outputSchema: {
      provider: z.enum(["github-actions", "generic"]),
      jobs: z.array(
        z.object({
          id: z.string(),
          name: z.string().optional(),
          runsOn: z.any().optional(),
          steps: z.array(
            z.object({
              name: z.string().optional(),
              uses: z.string().optional(),
              run: z.string().optional(),
              with: z.record(z.string(), z.any()).optional(),
            })
          ),
          strategy: z.any().optional(),
        })
      ),
      caches: z.array(z.object({ jobId: z.string(), stepIndex: z.number(), uses: z.string(), key: z.string().optional() })),
      matrix: z.array(z.object({ jobId: z.string(), dimensions: z.array(z.string()) })),
      warnings: z.array(z.string()),
    },
  },
  async ({ workflowYaml, provider }) => {
    try {
      const output = workflowParse({ workflowYaml, provider });
      return {
        content: [{ type: "text", text: JSON.stringify(output) }],
        structuredContent: output,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text", text: JSON.stringify({ error: message, suggestion: "Make sure the YAML is valid and includes `jobs:`." }) }],
        isError: true,
      };
    }
  }
);

server.registerTool(
  "pipeline_estimate",
  {
    title: "Pipeline Estimate",
    description: "Estimate runtime/build minutes from workflow model plus optional run history.",
    inputSchema: {
      workflowModel: z.any().describe("Output from workflow_parse (or compatible model)."),
      runHistory: z
        .array(z.object({ job: z.string().min(1), durationSec: z.number().nonnegative() }))
        .optional()
        .describe("Optional recent job durations (seconds)."),
      pricingModel: z.enum(["relative", "gh-actions-minutes"]).optional().describe("How to interpret minutes (best-effort)."),
    },
    outputSchema: {
      estimate: z.object({
        totalSeconds: z.number(),
        totalMinutes: z.number(),
        buildMinutes: z.number(),
        jobs: z.array(z.object({ jobId: z.string(), seconds: z.number(), minutes: z.number(), basis: z.enum(["history", "heuristic"]) })),
      }),
      biggestDrivers: z.array(z.object({ jobId: z.string(), minutes: z.number(), reason: z.string() })),
      sensitivity: z.array(z.object({ change: z.string(), estimatedMinutesSaved: z.number() })),
      warnings: z.array(z.string()),
    },
  },
  async ({ workflowModel, runHistory, pricingModel }) => {
    try {
      const output = pipelineEstimate({ workflowModel, runHistory, pricingModel });
      return {
        content: [{ type: "text", text: JSON.stringify(output) }],
        structuredContent: output,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text", text: JSON.stringify({ error: message, suggestion: "Pass workflowModel from workflow_parse and ensure runHistory durations are numbers." }) }],
        isError: true,
      };
    }
  }
);

// ============================================================================
// Express App Setup
// ============================================================================

const app = express();
app.use(express.json());

app.get("/health", (_req: Request, res: Response) => {
  res.status(200).json({ status: "healthy" });
});

app.post("/mcp", async (req: Request, res: Response) => {
  const startTime = Date.now();
  const body = req.body;
  const method = body?.method || "unknown";
  const params = body?.params;

  if (method === "tools/call") {
    const toolName = params?.name || "unknown";
    logRequest(`tools/call ${chalk.bold(toolName)}`, params?.arguments);
  } else if (method !== "notifications/initialized") {
    logRequest(method, params);
  }

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  let responseBody = "";
  const originalWrite = res.write.bind(res) as typeof res.write;
  const originalEnd = res.end.bind(res) as typeof res.end;

  res.write = function (
    chunk: unknown,
    encodingOrCallback?: BufferEncoding | ((error: Error | null | undefined) => void),
    callback?: (error: Error | null | undefined) => void
  ) {
    if (chunk) {
      responseBody += typeof chunk === "string" ? chunk : Buffer.from(chunk as ArrayBuffer).toString();
    }
    return originalWrite(chunk as string, encodingOrCallback as BufferEncoding, callback);
  };

  res.end = function (chunk?: unknown, encodingOrCallback?: BufferEncoding | (() => void), callback?: () => void) {
    if (chunk) {
      responseBody += typeof chunk === "string" ? chunk : Buffer.from(chunk as ArrayBuffer).toString();
    }

    if (method !== "notifications/initialized") {
      const latency = Date.now() - startTime;
      try {
        const rpcResponse = JSON.parse(responseBody) as { result?: unknown; error?: unknown };
        if (rpcResponse?.error) {
          logError(method, rpcResponse.error, latency);
        } else if (method === "tools/call") {
          const content = (rpcResponse?.result as { content?: Array<{ text?: string }> })?.content;
          const resultText = content?.[0]?.text;
          logResponse(method, resultText, latency);
        } else {
          logResponse(method, null, latency);
        }
      } catch {
        logResponse(method, null, latency);
      }
    }

    return originalEnd(chunk as string, encodingOrCallback as BufferEncoding, callback);
  };

  res.on("close", () => {
    transport.close();
  });

  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

app.use((_err: unknown, _req: Request, res: Response, _next: Function) => {
  res.status(500).json({ error: "Internal server error" });
});

const port = parseInt(process.env.PORT || "8080");
const httpServer = app.listen(port, () => {
  console.log();
  console.log(chalk.bold("MCP Server running on"), chalk.cyan(`http://localhost:${port}`));
  console.log(`  ${chalk.gray("Health:")} http://localhost:${port}/health`);
  console.log(`  ${chalk.gray("MCP:")}    http://localhost:${port}/mcp`);
  if (isDev) {
    console.log();
    console.log(chalk.gray("─".repeat(50)));
    console.log();
  }
});

process.on("SIGTERM", () => {
  console.log("Received SIGTERM, shutting down...");
  httpServer.close(() => {
    process.exit(0);
  });
});

