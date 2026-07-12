import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { DATA_DIR, TEAMCODE_JAVA_SUBDIR, ToolError, resolveProject } from "./paths.js";

const MARKER = /@ftc-mcp generated:\s*([a-z0-9-]+)/i;

function walk(dir: string, suffixes: string[]): string[] {
  if (!existsSync(dir)) return [];
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(full, suffixes));
    else if (suffixes.some((suffix) => entry.name.endsWith(suffix))) files.push(full);
  }
  return files;
}

function projectBackupRoot(project: string): string {
  const projectId = `${basename(project)}-${createHash("sha256").update(resolve(project)).digest("hex").slice(0, 8)}`;
  return join(DATA_DIR, "backups", projectId);
}

function allFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...allFiles(full));
    else if (entry.isFile()) files.push(full);
  }
  return files;
}

/** Copy existing targets out of the robot repository before an explicit overwrite. */
export function backupFiles(project: string, files: string[]): string | null {
  const existing = files.filter((file) => existsSync(file));
  if (!existing.length) return null;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const root = join(projectBackupRoot(project), stamp);
  for (const file of existing) {
    const destination = join(root, relative(project, file));
    mkdirSync(join(destination, ".."), { recursive: true });
    copyFileSync(file, destination);
  }
  return root;
}

export function listBackups(projectPath?: string): string {
  const project = resolveProject(projectPath);
  const root = projectBackupRoot(project);
  if (!existsSync(root)) return `No ftc-mcp backups for ${project}. Backups are created automatically before explicit overwrites.`;
  const snapshots = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({ id: entry.name, files: allFiles(join(root, entry.name)) }))
    .sort((a, b) => b.id.localeCompare(a.id));
  if (!snapshots.length) return `No ftc-mcp backups for ${project}.`;
  const lines = [`Backups for ${project}:`];
  for (const snapshot of snapshots) {
    lines.push(`\n${snapshot.id} (${snapshot.files.length} file${snapshot.files.length === 1 ? "" : "s"})`);
    lines.push(...snapshot.files.map((file) => `- ${relative(join(root, snapshot.id), file)}`));
  }
  lines.push("", "Use restore_backup with a backupId. Restoration previews by default and never deletes files.");
  return lines.join("\n");
}

export function restoreBackup(opts: {
  projectPath?: string;
  backupId: string;
  files?: string[];
  confirm?: boolean;
}): string {
  const project = resolveProject(opts.projectPath);
  if (!/^[A-Za-z0-9._-]+$/.test(opts.backupId)) {
    throw new ToolError("Invalid backupId. Use an exact ID from list_backups.");
  }
  const root = projectBackupRoot(project);
  const snapshot = join(root, opts.backupId);
  if (!existsSync(snapshot)) throw new ToolError(`Backup ${opts.backupId} not found. Use list_backups.`);
  const available = allFiles(snapshot);
  const byRelative = new Map(available.map((file) => [relative(snapshot, file), file]));
  const selectedNames = opts.files?.length ? opts.files : [...byRelative.keys()];
  const selected = selectedNames.map((name) => {
    if (isAbsolute(name) || name.split(/[\\/]+/).includes("..")) {
      throw new ToolError(`Unsafe backup file path: ${name}`);
    }
    const normalized = name.replace(/\\/g, "/");
    const source = byRelative.get(normalized) ?? byRelative.get(name);
    if (!source) throw new ToolError(`File ${name} is not in backup ${opts.backupId}.`);
    const destination = resolve(project, normalized);
    if (destination !== project && !destination.startsWith(project + sep)) {
      throw new ToolError(`Unsafe restore destination: ${name}`);
    }
    return { name: normalized, source, destination };
  });
  if (!selected.length) return `Backup ${opts.backupId} contains no files.`;
  if (!opts.confirm) {
    return (
      `RESTORE PREVIEW — no files written.\nBackup: ${opts.backupId}\nFiles:\n` +
      selected.map(({ name, destination }) => `- ${name} -> ${destination}${existsSync(destination) ? " (replaces current file)" : " (recreates missing file)"}`).join("\n") +
      `\n\nCall restore_backup again with confirm: true to restore these files. Current files will be backed up first.`
    );
  }
  const safetyBackup = backupFiles(project, selected.map(({ destination }) => destination));
  for (const { source, destination } of selected) {
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(source, destination);
  }
  return (
    `Restored ${selected.length} file${selected.length === 1 ? "" : "s"} from ${opts.backupId}:\n` +
    selected.map(({ name }) => `- ${name}`).join("\n") +
    (safetyBackup ? `\nCurrent versions were backed up first: ${safetyBackup}` : "")
  );
}

export function listGeneratedFiles(projectPath?: string): string {
  const project = resolveProject(projectPath);
  const candidates = [
    ...walk(join(project, TEAMCODE_JAVA_SUBDIR), [".java"]),
    ...walk(join(project, "docs"), [".md"]),
  ];
  const artifacts = candidates.flatMap((file) => {
    const marker = readFileSync(file, "utf8").match(MARKER);
    return marker ? [{ file: relative(project, file), kind: marker[1] }] : [];
  });
  if (!artifacts.length) {
    return "No marked ftc-mcp artifacts found. Older scaffolds created before provenance markers may still exist; inspect list_opmodes and list_subsystems.";
  }
  const grouped = new Map<string, string[]>();
  for (const artifact of artifacts) {
    const files = grouped.get(artifact.kind) ?? [];
    files.push(artifact.file);
    grouped.set(artifact.kind, files);
  }
  const lines = [`ftc-mcp scaffold inventory (${artifacts.length} files):`];
  for (const kind of [...grouped.keys()].sort()) {
    lines.push(`\n${kind}:`, ...grouped.get(kind)!.sort().map((file) => `- ${file}`));
  }
  lines.push("", "These markers identify scaffold origin only. Team edits are expected; never delete or regenerate a file without reviewing its current contents and Git diff.");
  return lines.join("\n");
}
