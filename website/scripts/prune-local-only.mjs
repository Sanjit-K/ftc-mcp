import { rmSync } from "node:fs";
import { resolve } from "node:path";

// Autonomous Studio reads local robot source through the FTC Toolchain process.
// Do not include it in the public GitHub Pages artifact.
rmSync(resolve("out/visualizer"), { recursive: true, force: true });
