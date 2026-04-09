# ci-log-optimizer-mcp

CI log analyzer MCP: regex-match failures, extract root causes, and estimate pipeline time/cost from workflow YAML and logs (**no external APIs**).

[Available on MCPize](https://mcpize.com/mcp/ci-log-optimizer-mcp)

## Tools


| Tool                  | Description                                                                    |
| --------------------- | ------------------------------------------------------------------------------ |
| `regex_test`          | Test a regex against text/logs and return matches with indices/groups          |
| `regex_explain`       | Lightweight regex summary + pitfalls/suggestions                               |
| `log_extract_signals` | Extract structured errors/warnings/failing tests/key lines from raw logs       |
| `log_match_patterns`  | Apply multiple regex patterns to logs and summarize frequency + sample matches |
| `workflow_parse`      | Parse CI workflow YAML (GitHub Actions-focused) into a normalized model        |
| `pipeline_estimate`   | Estimate runtime/build minutes from workflow model + optional job run history  |


## Connect via MCPize

```bash
npx -y mcpize connect @YOUR_MCPIZE_USERNAME/ci-log-optimizer-mcp --client claude
```

Or visit: [https://mcpize.com/mcp/ci-log-optimizer-mcp](https://mcpize.com/mcp/ci-log-optimizer-mcp)

## Quick Start (Local)

```bash
cd ci-log-optimizer-mcp
npm install
npm run build
npm run dev
```

Server endpoints:

- Health: `http://localhost:8080/health`
- MCP: `http://localhost:8080/mcp`

## Smoke test (MCP protocol)

1. Start the server (`npm run dev`) on port 3000/8080 (depending on how you run it).
2. Run:

```bash
cd ci-log-optimizer-mcp
MCP_URL=http://localhost:8080/mcp npm run smoke:mcp
```

## Deploy (MCPize)

```bash
cd ci-log-optimizer-mcp
mcpize login
mcpize deploy
```

## Notes / Safety

- Inputs are truncated to keep execution safe (logs up to ~1,000,000 chars; regex match limit).
- Regex explanation is intentionally lightweight (v1). The core value is CI log triage + workflow estimation.

