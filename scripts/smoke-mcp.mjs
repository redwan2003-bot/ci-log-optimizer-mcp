const MCP_URL = process.env.MCP_URL || "http://localhost:3000/mcp";

async function rpc(method, params) {
  const body = {
    jsonrpc: "2.0",
    id: Math.floor(Math.random() * 1e9),
    method,
    params,
  };
  const res = await fetch(MCP_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${text}`);
  }
  const parsed = JSON.parse(text);
  if (parsed.error) {
    throw new Error(`RPC error: ${JSON.stringify(parsed.error)}`);
  }
  return parsed.result;
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const result = await rpc("initialize", {
  protocolVersion: "2025-03-26",
  capabilities: {},
  clientInfo: { name: "smoke-test", version: "0.0.0" },
});
assert(result?.serverInfo?.name, "Missing serverInfo.name from initialize");

const tools = await rpc("tools/list", {});
const toolNames = (tools?.tools || []).map((t) => t.name);
const expected = [
  "regex_test",
  "regex_explain",
  "log_extract_signals",
  "log_match_patterns",
  "workflow_parse",
  "pipeline_estimate",
];
for (const name of expected) assert(toolNames.includes(name), `Missing tool: ${name}`);

await rpc("tools/call", {
  name: "regex_test",
  arguments: { pattern: "Error:", flags: "g", text: "Error: boom\\nOK\\nError: again" },
});

console.log("MCP smoke test passed.");

