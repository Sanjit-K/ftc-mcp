import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { PEDRO_DOCS_DIR, SAMPLES_DIR, ToolError, requireDir } from "./paths.js";

const CLONE_HINT =
  "Run: git clone --depth 1 https://github.com/FIRST-Tech-Challenge/FtcRobotController refs/FtcRobotController && " +
  "git clone --depth 1 https://github.com/Pedro-Pathing/Docs refs/PedroDocs (from the ftc-toolchain repo root).";

export interface SampleInfo {
  name: string;
  category: string;
  opModeType: "TeleOp" | "Autonomous" | "none";
  summary: string;
}

function extractSummary(source: string): string {
  // Take the first block comment that is not the copyright header.
  const blocks = source.match(/\/\*[\s\S]*?\*\//g) ?? [];
  for (const block of blocks) {
    if (/copyright/i.test(block)) continue;
    const lines = block
      .split("\n")
      .map((l) => l.replace(/^\s*\/?\*+\/?/, "").trim())
      .filter((l) => l.length > 0);
    if (lines.length === 0) continue;
    return lines.slice(0, 4).join(" ").slice(0, 400);
  }
  return "";
}

function categorize(name: string): string {
  const m = name.match(/^(Basic|Concept|Robot|Sensor|Sample|Utility)/);
  return m ? m[1] : "Other";
}

export function listSamples(category?: string): SampleInfo[] {
  const dir = requireDir(SAMPLES_DIR, CLONE_HINT);
  const results: SampleInfo[] = [];
  for (const file of readdirSync(dir).sort()) {
    if (!file.endsWith(".java")) continue;
    const name = file.replace(/\.java$/, "");
    const cat = categorize(name);
    if (category && cat.toLowerCase() !== category.toLowerCase()) continue;
    const source = readFileSync(join(dir, file), "utf8");
    const opModeType = /@TeleOp\b/.test(source)
      ? "TeleOp"
      : /@Autonomous\b/.test(source)
        ? "Autonomous"
        : "none";
    results.push({ name, category: cat, opModeType, summary: extractSummary(source) });
  }
  return results;
}

export function getSample(name: string): string {
  const dir = requireDir(SAMPLES_DIR, CLONE_HINT);
  const file = name.endsWith(".java") ? name : `${name}.java`;
  if (file.includes("/") || file.includes("..")) {
    throw new ToolError(`Invalid sample name: ${name}`);
  }
  try {
    return readFileSync(join(dir, file), "utf8");
  } catch {
    const available = readdirSync(dir)
      .filter((f) => f.toLowerCase().includes(name.toLowerCase().slice(0, 6)))
      .join(", ");
    throw new ToolError(
      `Sample not found: ${name}. ${available ? `Did you mean: ${available}?` : "Use list_samples to see all samples."}`
    );
  }
}

// ---------- Pedro Pathing docs ----------

interface DocEntry {
  /** e.g. "pathing/examples/auto" */
  id: string;
  title: string;
  text: string;
}

let docCache: DocEntry[] | null = null;

function walkMdx(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkMdx(full));
    else if (entry.name.endsWith(".mdx")) out.push(full);
  }
  return out;
}

/** Strip MDX frontmatter/imports/JSX so what remains reads as markdown. */
function cleanMdx(raw: string): { title: string; text: string } {
  let title = "";
  let text = raw;
  const fm = text.match(/^---\n([\s\S]*?)\n---\n/);
  if (fm) {
    const t = fm[1].match(/title:\s*(.*)/);
    if (t) title = t[1].trim().replace(/^["']|["']$/g, "");
    text = text.slice(fm[0].length);
  }
  text = text
    .replace(/^import .*$/gm, "")
    .replace(/<\/?[A-Z][a-zA-Z]*[^>]*\/?>/g, "")
    .trim();
  return { title, text };
}

export function loadDocs(): DocEntry[] {
  if (docCache) return docCache;
  const dir = requireDir(PEDRO_DOCS_DIR, CLONE_HINT);
  docCache = walkMdx(dir).map((file) => {
    const { title, text } = cleanMdx(readFileSync(file, "utf8"));
    const id = relative(dir, file).replace(/\.mdx$/, "");
    return { id, title: title || id, text };
  });
  return docCache;
}

export function getDoc(id: string): DocEntry {
  const normalized = id.replace(/\.mdx$/, "").replace(/^\/+|\/+$/g, "");
  const doc = loadDocs().find((d) => d.id === normalized);
  if (!doc) {
    throw new ToolError(
      `Doc not found: ${id}. Available: ${loadDocs()
        .map((d) => d.id)
        .join(", ")}`
    );
  }
  return doc;
}

export interface SearchHit {
  source: "pedro-docs" | "sdk-sample";
  id: string;
  title: string;
  snippet: string;
  score: number;
}

function scoreAndSnippet(
  text: string,
  title: string,
  terms: string[]
): { score: number; snippet: string } {
  const lower = text.toLowerCase();
  const titleLower = title.toLowerCase();
  const words = [...new Set((`${title} ${text}`).toLowerCase().match(/[a-z0-9]+/g) ?? [])];
  let score = 0;
  let firstIdx = -1;
  let matched = 0;
  for (const term of terms) {
    let actual = term;
    let idx = lower.indexOf(actual);
    if (idx === -1 && term.length >= 5) {
      const threshold = term.length >= 8 ? 2 : 1;
      actual = words.find((word) => Math.abs(word.length - term.length) <= threshold && editDistance(word, term) <= threshold) ?? term;
      idx = lower.indexOf(actual);
    }
    let count = 0;
    while (idx !== -1 && count < 50) {
      count++;
      if (firstIdx === -1) firstIdx = idx;
      idx = lower.indexOf(actual, idx + actual.length);
    }
    if (count) matched++;
    score += Math.min(count, 12);
    if (titleLower.includes(actual)) score += 30;
  }
  if (score === 0) return { score: 0, snippet: "" };
  const coverage = matched / terms.length;
  score = Math.round(score * coverage * coverage + (coverage === 1 ? 40 : 0));
  const start = Math.max(0, (firstIdx === -1 ? 0 : firstIdx) - 80);
  const snippet = text.slice(start, start + 300).replace(/\s+/g, " ").trim();
  return { score, snippet: (start > 0 ? "…" : "") + snippet + "…" };
}

function editDistance(a: string, b: string): number {
  const previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[b.length];
}

export function resetKnowledgeCache(): void {
  docCache = null;
}

export function searchDocs(query: string, limit = 8): SearchHit[] {
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 1);
  if (terms.length === 0) throw new ToolError("Query is empty.");

  const hits: SearchHit[] = [];
  for (const doc of loadDocs()) {
    const { score, snippet } = scoreAndSnippet(doc.text, doc.title, terms);
    if (score > 0)
      hits.push({ source: "pedro-docs", id: doc.id, title: doc.title, snippet, score });
  }
  const dir = requireDir(SAMPLES_DIR, CLONE_HINT);
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".java")) continue;
    const name = file.replace(/\.java$/, "");
    const source = readFileSync(join(dir, file), "utf8");
    const { score, snippet } = scoreAndSnippet(source, name, terms);
    if (score > 0)
      hits.push({ source: "sdk-sample", id: name, title: name, snippet, score });
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}
