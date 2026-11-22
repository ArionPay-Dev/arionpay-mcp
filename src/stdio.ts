#!/usr/bin/env node
/**
 * ArionPay MCP server on stdio (started by the AI app: Claude Desktop, Claude Code, Cursor, VS Code …).
 * stdout carries only MCP messages; everything else goes to stderr.
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { configFromEnv } from "./config.js";
import { createServer, VERSION } from "./server.js";

if (process.argv.includes("--version")) {
  process.stderr.write(`${VERSION}\n`);
  process.exit(0);
}

let config;
try {
  config = configFromEnv();
} catch (e) {
  process.stderr.write(`arionpay-mcp: ${(e as Error).message}\n`);
  process.exit(1);
}
const server = createServer(config);
await server.connect(new StdioServerTransport());
process.stderr.write(`arionpay-mcp ${VERSION} ready (${config.apiKey ? `store tools on, ${config.readOnly ? "read-only" : config.live ? `real invoices up to ${config.maxAmount}` : "test invoices only"}` : "docs only: no store keys set"})\n`);
