#!/usr/bin/env node
// Integration test: install Pedro + scaffold every template into a project, then build it.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const project = process.argv[2] ?? join(ROOT, "refs/FtcRobotController");

const transport = new StdioClientTransport({ command: "node", args: [join(ROOT, "dist/index.js")] });
const client = new Client({ name: "pedro-build-test", version: "0.0.1" });
await client.connect(transport);

async function call(name, args) {
  const res = await client.callTool({ name, arguments: args });
  const text = res.content.map((c) => c.text).join("\n");
  console.log(`--- ${name} ${res.isError ? "(ERROR)" : ""}\n${text.slice(0, 600)}`);
  if (res.isError) {
    await client.close();
    process.exit(1);
  }
  return text;
}

await call("install_pedro", { projectPath: project });
for (const [className, template] of [
  ["GenLinearTeleop", "linear-teleop"],
  ["GenMecanumTeleop", "mecanum-teleop"],
  ["GenLinearAuto", "linear-auto"],
  ["GenPedroAuto", "pedro-auto"],
  ["GenPedroTeleop", "pedro-teleop"],
]) {
  await call("create_opmode", { projectPath: project, className, template, overwrite: true });
}
await call("list_opmodes", { projectPath: project });
await call("build", { projectPath: project });
await client.close();
console.log("PEDRO INTEGRATION TEST PASSED");
