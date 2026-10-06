import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AxiError } from "./errors.js";
import { tildify } from "./format.js";

/** Text every managed omp extension carries; used to recognize our file. */
export const OMP_MARKER = "but-axi-omp-extension";

export function ompPaths(home = homedir()): { dir: string; file: string } {
  const dir = join(home, ".omp", "agent", "extensions");
  return { dir, file: join(dir, "but-axi.ts") };
}

/** Locate omp/but-axi.ts in the package (dist/src/omp.js -> ../../omp/, or src/omp.ts -> ../omp/). */
export function templatePath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const p of [join(here, "..", "..", "omp", "but-axi.ts"), join(here, "..", "omp", "but-axi.ts")]) {
    if (existsSync(p)) return p;
  }
  throw new AxiError("omp extension template not found (omp/but-axi.ts)", "TEMPLATE_MISSING", ["Reinstall but-axi from a full clone"]);
}

/** Render the extension with absolute node + script paths baked in. */
export function renderOmpExtension(node: string, script: string, template = readFileSync(templatePath(), "utf8")): string {
  return template.replace("__BUT_AXI_NODE__", JSON.stringify(node)).replace("__BUT_AXI_SCRIPT__", JSON.stringify(script));
}

function stamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** Backups go next to (not inside) the auto-discovered extensions dir so omp never loads them. */
function backupPath(home: string): string {
  const base = join(home, ".omp", "agent", `but-axi.ts.bak-but-axi-${stamp()}`);
  let p = base;
  for (let i = 1; existsSync(p); i++) p = `${base}-${i}`;
  return p;
}

export interface OmpResult {
  action: string;
  file: string;
  backup: string;
}

export function ompInstalled(home = homedir()): boolean {
  const { file } = ompPaths(home);
  return existsSync(file) && readFileSync(file, "utf8").includes(OMP_MARKER);
}

export function ompOps(opts: { home?: string; uninstall?: boolean; dryRun?: boolean; node: string; script: string; template?: string }): OmpResult {
  const home = opts.home ?? homedir();
  const { dir, file } = ompPaths(home);
  const shown = tildify(file);
  const exists = existsSync(file);
  const current = exists ? readFileSync(file, "utf8") : "";
  if (exists && !current.includes(OMP_MARKER)) {
    // Never overwrite or delete an extension we did not write.
    throw new AxiError(`refusing to touch ${tildify(file)}: it exists and is not managed by but-axi`, "FOREIGN_FILE", ["Move or rename that file, then rerun `but-axi setup hooks --agents omp`"]);
  }
  if (opts.uninstall) {
    if (!exists) return { action: "not installed (no change)", file: shown, backup: "" };
    if (opts.dryRun) return { action: "would remove", file: shown, backup: "" };
    const bak = backupPath(home);
    copyFileSync(file, bak);
    rmSync(file);
    return { action: "removed", file: shown, backup: tildify(bak) };
  }
  const next = renderOmpExtension(opts.node, opts.script, opts.template);
  if (exists && current === next) return { action: "already installed (no change)", file: shown, backup: "" };
  if (opts.dryRun) return { action: exists ? "would update" : "would install", file: shown, backup: "" };
  let backup = "(new file)";
  if (exists) {
    const bak = backupPath(home);
    copyFileSync(file, bak);
    backup = tildify(bak);
  }
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, next);
  return { action: exists ? "updated" : "installed", file: shown, backup };
}
