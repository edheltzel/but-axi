import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { AxiError } from "./errors.js";

export interface ButResult {
  code: number;
  stdout: string;
  stderr: string;
  json?: unknown;
}

export function debug(msg: string): void {
  if (process.env.BUT_AXI_DEBUG) process.stderr.write(`[but-axi] ${msg}\n`);
}

let cachedBut: string | undefined;

/** Locate the `but` binary: $BUT_AXI_BUT, then PATH, then common install dirs (hooks may run with a thin PATH). */
export function resolveBut(): string {
  if (process.env.BUT_AXI_BUT) return process.env.BUT_AXI_BUT;
  if (cachedBut) return cachedBut;
  const dirs = [
    ...(process.env.PATH ?? "").split(delimiter).filter(Boolean),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    join(homedir(), ".local", "bin"),
  ];
  for (const d of dirs) {
    const p = join(d, "but");
    if (existsSync(p)) {
      cachedBut = p;
      return p;
    }
  }
  cachedBut = "but";
  return cachedBut;
}

function parseJson(text: string): unknown {
  const t = text.trim();
  if (!t || (t[0] !== "{" && t[0] !== "[")) return undefined;
  try {
    return JSON.parse(t);
  } catch {
    return undefined;
  }
}

/** Run `but -C <cwd> <args> --json` non-interactively (stdin closed, pager/editor disabled). */
export function runBut(args: string[], cwd: string, json = true): ButResult {
  const bin = resolveBut();
  const full = ["-C", cwd, ...args, ...(json ? ["--json"] : [])];
  debug(`exec ${bin} ${full.join(" ")}`);
  const r = spawnSync(bin, full, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 120_000,
    maxBuffer: 64 * 1024 * 1024,
    env: {
      ...process.env,
      BUT_PAGER: "cat",
      PAGER: "cat",
      GIT_PAGER: "cat",
      NO_COLOR: "1",
      GIT_TERMINAL_PROMPT: "0",
      GIT_EDITOR: "true",
      EDITOR: "true",
      VISUAL: "true",
    },
  });
  if (r.error) {
    const code = (r.error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      throw new AxiError("GitButler CLI `but` not found", "BUT_NOT_FOUND", [
        "Install GitButler (https://gitbutler.com) and enable its CLI: https://docs.gitbutler.com/cli-overview",
        "Or set BUT_AXI_BUT=/path/to/but",
      ]);
    }
    throw new AxiError(`failed to run but: ${r.error.message}`, "BUT_EXEC_FAILED");
  }
  const stdout = r.stdout ?? "";
  const stderr = r.stderr ?? "";
  debug(`exit ${r.status} stdout=${stdout.length}B stderr=${stderr.length}B`);
  if (stderr && process.env.BUT_AXI_DEBUG) process.stderr.write(stderr);
  return { code: r.status ?? 1, stdout, stderr, json: parseJson(stdout) };
}

/** Run and return parsed JSON, throwing a structured AxiError on failure. */
export function butJson<T = unknown>(args: string[], cwd: string): T {
  const r = runBut(args, cwd);
  if (r.code !== 0) throw butError(r, args);
  if (r.json === undefined) {
    // Some mutations print nothing in JSON mode; treat as an empty object.
    return {} as T;
  }
  return r.json as T;
}

export function cleanMessage(text: string): string {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => !/^(Usage:|For more information)/.test(l));
  const first = (lines[0] ?? "").replace(/^Error:\s*/i, "").replace(/^error:\s*/, "");
  return first;
}

/** Convert a failed `but` invocation into a structured error. */
export function butError(r: ButResult, args: string[]): AxiError {
  const j = r.json as { error?: string; message?: string; hint?: string } | undefined;
  const help: string[] = [];
  let code = "BUT_ERROR";
  let message: string;
  if (j && typeof j === "object" && typeof j.error === "string") {
    code = j.error.toUpperCase();
    message = j.message ?? j.error;
    if (j.hint) help.push(`but hint: ${j.hint}`);
  } else {
    message = cleanMessage(r.stderr) || cleanMessage(r.stdout) || `but ${args[0]} exited ${r.code}`;
    // but sometimes repeats the message twice on one line
    const half = message.length / 2;
    if (Number.isInteger(half - 0.5) && message.slice(0, half - 0.5) === message.slice(half + 0.5)) {
      message = message.slice(0, half - 0.5);
    }
  }
  if (/No GitButler project|No git repository|setup required/i.test(message) || code === "SETUP_REQUIRED") {
    code = "NOT_A_WORKSPACE";
    help.length = 0;
    help.push("Run `but setup` in the repository to enable GitButler (raw but; not wrapped)");
    help.push("Or pass `-C <path>` to point at a GitButler workspace");
  } else {
    const label = ["branch", "oplog"].includes(args[0] ?? "") && args[1] && !args[1].startsWith("-") ? `${args[0]} ${args[1]}` : args[0];
    help.push(`Run \`but ${label} --help\` for raw but usage`);
  }
  return new AxiError(message, code, help);
}
