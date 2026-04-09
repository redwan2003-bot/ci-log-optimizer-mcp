# ci-log-optimizer-mcp

## Project Structure
- `src/index.ts`: Express HTTP server + MCP registration (`/mcp`, `/health`)
- `src/tools.ts`: Pure tool logic (easy to unit test)
- `tests/tools.test.ts`: Vitest unit tests for tool logic
- `scripts/smoke-mcp.mjs`: Minimal JSON-RPC smoke test against `/mcp`
- `mcpize.yaml`: MCPize deployment config (HTTP transport)

## Key Commands
- `npm run dev`: run locally with hot reload
- `npm run build`: compile to `dist/`
- `npm test`: run unit tests
- `npm run smoke:mcp`: run MCP protocol smoke test (set `MCP_URL`)
- `mcpize deploy`: deploy to MCPize Cloud (after `mcpize login`)

## Adding a New Tool
1. Implement a pure function + result type in `src/tools.ts`
2. Register the tool in `src/index.ts` with `server.registerTool(...)`
3. Add/extend unit tests in `tests/tools.test.ts`
4. Add the tool to the README tools table

## Environment Variables
- `PORT`: HTTP port (default 8080)
- `NODE_ENV`: set to `production` to disable dev logging

