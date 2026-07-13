import { cpSync, existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const source = resolve("website/out");
const target = resolve("studio-dist");

if (!existsSync(resolve(source, "visualizer/index.html"))) {
  throw new Error(`Local studio export missing at ${source}`);
}
rmSync(target, { recursive: true, force: true });
cpSync(source, target, { recursive: true });
console.log(`Copied local Autonomous Studio bundle to ${target}`);
