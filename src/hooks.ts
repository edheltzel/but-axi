import { copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { AxiError } from "./errors.js";
import { tildify, type Row } from "./format.js";

export type Agent = "claude" | "codex" | "cursor";
export const AGENTS: Agent[] = ["claude", "codex", "cursor"];
/** Stable symlink that survives Homebrew node upgrades. */
export const STABLE_NODE = process.env.BUT_AXI_NODE ?? "/opt/homebrew/bin/node";
export const MARKER = "but-axi hook session-start";

export interface AgentTarget {
  agent: Agent;
  dir: string;
  file: string;
}

export function targets(home = homedir()): AgentTarget[] {
  return [
    { agent: "claude", dir: join(home, ".claude"), file: join(home, ".claude", "settings.json") },
    { agent: "codex", dir: join(home, ".codex"), file: join(home, ".codex", "hooks.json") },
    { agent: "cursor", dir: join(home, ".cursor"), file: join(home, ".cursor", "hooks.json") },
  ];
}

/** Absolute, PATH-independent hook command (GUI-launched agents often have a thin PATH). */
export function hookCommand(agent: Agent, nodePath = process.execPath, script = process.argv[1] ?? ""): string {
  const q = (s: string) => `'${s.replace(/'/g, "'\\''")}'`;
  let node = nodePath;
  let js = script;
  if (existsSync(STABLE_NODE)) node = STABLE_NODE;
  else if (/fnm_multishells|\/tmp\//.test(nodePath)) {
    try {
      node = realpathSync(nodePath);
    } catch {
      /* keep */
    }
  }
  try {
    js = realpathSync(script);
  } catch {
    /* keep */
  }
  // The marker text must appear verbatim in the command so install/uninstall can find it.
  return `${q(node)} ${q(js)} hook session-start --agent ${agent} # ${MARKER}`;
}

export function isManaged(cmd: unknown): boolean {
  return typeof cmd === "string" && cmd.includes(MARKER);
}

type Json = Record<string, any>;

interface Entry {
  type?: string;
  command?: string;
  timeout?: number;
  [k: string]: unknown;
}
interface Group {
  matcher?: string;
  hooks?: Entry[];
  [k: string]: unknown;
}

/** Pure: add or repair the managed SessionStart group (Claude Code / Codex shape). Returns [next, changed]. */
export function upsertGroupHook(settings: Json, command: string, timeoutSec: number): [Json, boolean] {
  const next: Json = structuredClone(settings ?? {});
  next.hooks ??= {};
  const groups: Group[] = Array.isArray(next.hooks.SessionStart) ? next.hooks.SessionStart : [];
  let found = false;
  let changed = false;
  for (const g of groups) {
    for (const h of g.hooks ?? []) {
      if (isManaged(h.command)) {
        if (found) continue;
        found = true;
        if (h.command !== command || h.timeout !== timeoutSec || h.type !== "command") {
          h.type = "command";
          h.command = command;
          h.timeout = timeoutSec;
          changed = true;
        }
      }
    }
  }
  // Drop duplicate managed entries beyond the first.
  let seen = false;
  const emptied = new Set<Group>();
  for (const g of groups) {
    const before = (g.hooks ?? []).length;
    g.hooks = (g.hooks ?? []).filter((h) => {
      if (!isManaged(h.command)) return true;
      if (seen) return false;
      seen = true;
      return true;
    });
    if (g.hooks.length !== before) {
      changed = true;
      if (g.hooks.length === 0) emptied.add(g);
    }
  }
  if (!found) {
    groups.push({ matcher: "", hooks: [{ type: "command", command, timeout: timeoutSec }] });
    changed = true;
  }
  next.hooks.SessionStart = groups.filter((g) => !emptied.has(g));
  return [next, changed];
}

export function removeGroupHook(settings: Json): [Json, boolean] {
  const next: Json = structuredClone(settings ?? {});
  const groups: Group[] | undefined = next.hooks?.SessionStart;
  if (!Array.isArray(groups)) return [next, false];
  let changed = false;
  const kept: Group[] = [];
  for (const g of groups) {
    const hooks = (g.hooks ?? []).filter((h) => !isManaged(h.command));
    if (hooks.length !== (g.hooks ?? []).length) changed = true;
    if (hooks.length > 0) kept.push({ ...g, hooks });
    else if ((g.hooks ?? []).length === 0) kept.push(g);
  }
  next.hooks.SessionStart = kept;
  return [next, changed];
}

/** Pure: Cursor shape — hooks.sessionStart is a flat list of {command, timeout}. */
export function upsertFlatHook(settings: Json, command: string, timeoutSec: number): [Json, boolean] {
  const next: Json = structuredClone(settings ?? {});
  next.version ??= 1;
  next.hooks ??= {};
  const list: Entry[] = Array.isArray(next.hooks.sessionStart) ? next.hooks.sessionStart : [];
  const managed = list.filter((h) => isManaged(h.command));
  let changed = false;
  if (managed.length === 0) {
    list.push({ command, timeout: timeoutSec });
    changed = true;
  } else {
    const first = managed[0]!;
    if (first.command !== command || first.timeout !== timeoutSec) {
      first.command = command;
      first.timeout = timeoutSec;
      changed = true;
    }
  }
  const deduped = list.filter((h) => !isManaged(h.command) || h === (managed[0] ?? h));
  if (deduped.length !== list.length) changed = true;
  next.hooks.sessionStart = deduped;
  return [next, changed];
}

export function removeFlatHook(settings: Json): [Json, boolean] {
  const next: Json = structuredClone(settings ?? {});
  const list: Entry[] | undefined = next.hooks?.sessionStart;
  if (!Array.isArray(list)) return [next, false];
  const kept = list.filter((h) => !isManaged(h.command));
  next.hooks.sessionStart = kept;
  return [next, kept.length !== list.length];
}

function readJson(file: string): Json {
  if (!existsSync(file)) return {};
  const text = readFileSync(file, "utf8");
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new AxiError(`refusing to edit ${tildify(file)}: invalid JSON (${(e as Error).message})`, "INVALID_CONFIG", ["Fix the file by hand, then rerun `but-axi setup hooks`"]);
  }
}

function stamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** Back up then write; returns backup path ("" if the file did not exist). */
function writeWithBackup(file: string, data: Json): string {
  let backup = "";
  if (existsSync(file)) {
    backup = `${file}.bak-but-axi-${stamp()}`;
    copyFileSync(file, backup);
  } else {
    mkdirSync(dirname(file), { recursive: true });
  }
  writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
  return backup;
}

export interface HookResult extends Row {
  agent: string;
  action: string;
  file: string;
  backup: string;
}

export function parseAgents(value: string | undefined): Agent[] | undefined {
  if (!value) return undefined;
  const list = value.split(",").map((s) => s.trim()).filter(Boolean);
  const bad = list.filter((a) => !AGENTS.includes(a as Agent));
  if (bad.length) throw new AxiError(`unknown agent ${bad.join(", ")}`, "UNKNOWN_AGENT", [`Supported agents: ${AGENTS.join(",")}`], 2);
  return list as Agent[];
}

export function installHooks(opts: { agents?: Agent[]; home?: string; uninstall?: boolean; dryRun?: boolean; timeoutSec?: number } = {}): HookResult[] {
  const out: HookResult[] = [];
  const timeout = opts.timeoutSec ?? 10;
  for (const t of targets(opts.home)) {
    const explicit = opts.agents?.includes(t.agent) ?? false;
    if (opts.agents && !explicit) continue;
    if (!existsSync(t.dir) && !explicit) {
      out.push({ agent: t.agent, action: "skipped (not installed)", file: tildify(t.file), backup: "" });
      continue;
    }
    const cur = readJson(t.file);
    const cmd = hookCommand(t.agent);
    const flat = t.agent === "cursor";
    const [next, changed] = opts.uninstall
      ? flat
        ? removeFlatHook(cur)
        : removeGroupHook(cur)
      : flat
        ? upsertFlatHook(cur, cmd, timeout)
        : upsertGroupHook(cur, cmd, timeout);
    if (!changed) {
      out.push({ agent: t.agent, action: opts.uninstall ? "not installed (no change)" : "already installed (no change)", file: tildify(t.file), backup: "" });
      continue;
    }
    if (opts.dryRun) {
      out.push({ agent: t.agent, action: opts.uninstall ? "would remove" : "would install", file: tildify(t.file), backup: "" });
      continue;
    }
    const backup = writeWithBackup(t.file, next);
    out.push({ agent: t.agent, action: opts.uninstall ? "removed" : "installed", file: tildify(t.file), backup: backup ? tildify(backup) : "(new file)" });
  }
  return out;
}

export function hookStatus(home = homedir()): Row[] {
  return targets(home).map((t) => {
    if (!existsSync(t.dir)) return { agent: t.agent, installed: false, file: tildify(t.file), note: "agent not installed" };
    let cur: Json = {};
    try {
      cur = readJson(t.file);
    } catch {
      return { agent: t.agent, installed: false, file: tildify(t.file), note: "invalid JSON" };
    }
    const cmds: unknown[] =
      t.agent === "cursor"
        ? (cur.hooks?.sessionStart ?? []).map((h: Entry) => h.command)
        : (cur.hooks?.SessionStart ?? []).flatMap((g: Group) => (g.hooks ?? []).map((h) => h.command));
    return { agent: t.agent, installed: cmds.some(isManaged), file: tildify(t.file), note: "ok" };
  });
}

/** Read hook stdin JSON without ever blocking the session (bounded wait). */
export async function readHookInput(timeoutMs = 300): Promise<Json | undefined> {
  if (process.stdin.isTTY) return undefined;
  return new Promise((resolveP) => {
    let buf = "";
    const done = (v: Json | undefined) => {
      clearTimeout(timer);
      process.stdin.removeAllListeners();
      process.stdin.pause();
      process.stdin.unref?.();
      resolveP(v);
    };
    const timer = setTimeout(() => done(tryParse(buf)), timeoutMs);
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => (buf += c));
    process.stdin.on("end", () => done(tryParse(buf)));
    process.stdin.on("error", () => done(undefined));
  });
}

function tryParse(s: string): Json | undefined {
  try {
    return s.trim() ? JSON.parse(s) : undefined;
  } catch {
    return undefined;
  }
}

/** Pick the session directory from hook input / env, falling back to cwd. */
export function hookCwd(input: Json | undefined, env = process.env, cwd = process.cwd()): string {
  if (input && typeof input.cwd === "string" && input.cwd) return input.cwd;
  if (input && Array.isArray(input.workspace_roots) && typeof input.workspace_roots[0] === "string") return input.workspace_roots[0];
  if (env.CLAUDE_PROJECT_DIR) return env.CLAUDE_PROJECT_DIR;
  if (env.CURSOR_PROJECT_DIR) return env.CURSOR_PROJECT_DIR;
  return cwd;
}
