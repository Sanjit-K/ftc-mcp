#!/usr/bin/env node
// Optional integration test: real Gradle build of the refs SDK clone via the MCP build tool.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const project = process.argv[2] ?? join(ROOT, "refs/FtcRobotController");

const transport = new StdioClientTransport({ command: "node", args: [join(ROOT, "dist/index.js")] });
const client = new Client({ name: "build-test", version: "0.0.1" });
await client.connect(transport);
const res = await client.callTool({ name: "build", arguments: { projectPath: project } });
console.log(res.isError ? "BUILD TOOL ERROR:" : "BUILD TOOL OK:");
console.log(res.content.map((c) => c.text).join("\n"));
await client.close();
process.exit(res.isError ? 1 : 0);
