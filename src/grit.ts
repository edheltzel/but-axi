import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { debug } from "./but.js";
import { AxiError } from "./errors.js";

/**
 * Read-only history engine. Uses GitButler's `grit` (Git in Rust, `--json`) when installed, else plain `git`.
 * Only these grit verbs are ever run: grit mutations (commit, switch, reset, ...) move HEAD behind GitButler's back.
 */
const GRIT_READ_ONLY = new Set(["log", "blame"]);

export type Engine = "grit" | "git";

export interface LogCommit {
  sha: string;
  subject: string;
  author: string;
  date: string;
  refs: string;
}

export interface BlameLine {
  line: number;
  sha: string;
  author: string;
  date: string;
  summary: string;
  uncommitted: boolean;
}

let cachedGrit: string | null | undefined;

/** Locate `grit`: $BUT_AXI_GRIT, then PATH, then the install script's ~/.local/bin. BUT_AXI_NO_GRIT=1 disables it. */
export function resolveGrit(env = process.env): string | undefined {
  if (env.BUT_AXI_NO_GRIT) return undefined;
  if (env.BUT_AXI_GRIT) return env.BUT_AXI_GRIT;
  if (cachedGrit !== undefined) return cachedGrit ?? undefined;
  const dirs = [...(env.PATH ?? "").split(delimiter).filter(Boolean), join(homedir(), ".local", "bin")];
  cachedGrit = dirs.map((d) => join(d, "grit")).find((p) => existsSync(p)) ?? null;
  return cachedGrit ?? undefined;
}

function exec(bin: string, args: string[], cwd: string): { code: number; stdout: string; stderr: string } {
  debug(`exec ${bin} ${args.join(" ")} (cwd ${cwd})`);
  const r = spawnSync(bin, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 60_000,
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, NO_COLOR: "1", GIT_PAGER: "cat", PAGER: "cat", GIT_TERMINAL_PROMPT: "0" },
  });
  if (r.error) throw new AxiError(`failed to run ${bin}: ${r.error.message}`, "HISTORY_EXEC_FAILED");
  return { code: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

function grit<T>(bin: string, args: string[], cwd: string): T {
  if (!GRIT_READ_ONLY.has(args[0] ?? "")) throw new AxiError(`refusing to run grit ${args[0]}: but-axi only runs read-only grit verbs`, "GRIT_NOT_ALLOWED");
  const r = exec(bin, [args[0]!, "--json", ...args.slice(1)], cwd);
  let j: unknown;
  try {
    j = JSON.parse(r.stdout || r.stderr);
  } catch {
    j = undefined;
  }
  if (r.code !== 0) {
    const e = j as { error?: string; kind?: string } | undefined;
    throw historyError(e?.error ?? (r.stderr.trim().split("\n")[0] || `grit ${args[0]} exited ${r.code}`), e?.kind);
  }
  return j as T;
}

function git(args: string[], cwd: string): string {
  const r = exec("git", args, cwd);
  if (r.code !== 0) throw historyError(r.stderr.trim().split("\n")[0]?.replace(/^(fatal|error):\s*/, "") || `git ${args[0]} exited ${r.code}`);
  return r.stdout;
}

function historyError(message: string, kind?: string): AxiError {
  if (kind === "not_a_repository" || /not a git repository/i.test(message)) {
    return new AxiError(message, "NOT_A_REPOSITORY", ["Pass `-C <path>` to point at a Git repository"]);
  }
  if (kind === "path_not_found" || /no such path|does not exist/i.test(message)) return new AxiError(message, "PATH_NOT_FOUND", ["Paths are repository-relative"]);
  return new AxiError(message, "HISTORY_ERROR", ["Run with BUT_AXI_NO_GRIT=1 to retry with plain git"]);
}

interface GritLog {
  commits?: { oid: string; subject?: string; author?: { name?: string; date?: string }; refs?: { name: string; kind?: string }[] }[];
}

/** Up to `limit + 1` commits so the caller can tell whether more exist. */
export function historyLog(cwd: string, opts: { rev?: string; limit: number; paths?: string[] }): { engine: Engine; commits: LogCommit[] } {
  const bin = resolveGrit();
  const want = opts.limit + 1;
  const tail = opts.paths?.length ? ["--", ...opts.paths] : [];
  if (bin) {
    const j = grit<GritLog>(bin, ["log", "-n", String(want), ...(opts.rev ? [opts.rev] : []), ...tail], cwd);
    const commits = (j.commits ?? []).map((c) => ({
      sha: c.oid,
      subject: c.subject ?? "",
      author: c.author?.name ?? "",
      date: c.author?.date ?? "",
      refs: (c.refs ?? []).filter((r) => r.kind !== "head").map((r) => r.name).join(" "),
    }));
    return { engine: "grit", commits };
  }
  const out = git(["log", "-n", String(want), "--format=%H%x1f%s%x1f%an%x1f%aI%x1f%D%x1e", ...(opts.rev ? [opts.rev] : []), ...tail], cwd);
  const commits = out
    .split("\x1e")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const [sha = "", subject = "", author = "", date = "", refs = ""] = s.split("\x1f");
      return { sha, subject, author, date, refs: refs.split(", ").map((r) => r.replace(/^HEAD -> /, "")).filter((r) => r && r !== "HEAD").join(" ") };
    });
  return { engine: "git", commits };
}

interface GritBlame {
  lines?: { commit: string; final_line: number; not_committed?: boolean }[];
  commits?: Record<string, { author?: { name?: string; date?: string }; summary?: string }>;
}

const ZERO = /^0+$/;

/** Per-line blame of the working tree file (uncommitted lines marked), or of `rev` when given. */
export function historyBlame(cwd: string, file: string, opts: { range?: string; rev?: string }): { engine: Engine; lines: BlameLine[] } {
  const bin = resolveGrit();
  const range = opts.range ? ["-L", opts.range] : [];
  if (bin) {
    const j = grit<GritBlame>(bin, ["blame", ...range, ...(opts.rev ? ["--rev", opts.rev] : []), "--", file], cwd);
    const lines = (j.lines ?? []).map((l) => {
      const c = j.commits?.[l.commit];
      const uncommitted = !!l.not_committed || ZERO.test(l.commit);
      return { line: l.final_line, sha: l.commit, author: uncommitted ? "" : (c?.author?.name ?? ""), date: uncommitted ? "" : (c?.author?.date ?? ""), summary: uncommitted ? "" : (c?.summary ?? ""), uncommitted };
    });
    return { engine: "grit", lines };
  }
  const out = git(["blame", "--porcelain", ...range, ...(opts.rev ? [opts.rev] : []), "--", file], cwd);
  const meta = new Map<string, { author: string; date: string; summary: string }>();
  const lines: BlameLine[] = [];
  let cur: { sha: string; line: number } | undefined;
  for (const l of out.split("\n")) {
    const head = /^([0-9a-f]{40}) \d+ (\d+)/.exec(l);
    if (head) {
      cur = { sha: head[1]!, line: Number(head[2]) };
      if (!meta.has(cur.sha)) meta.set(cur.sha, { author: "", date: "", summary: "" });
      continue;
    }
    if (!cur) continue;
    const m = meta.get(cur.sha)!;
    if (l.startsWith("author ")) m.author = l.slice(7);
    else if (l.startsWith("author-time ")) m.date = new Date(Number(l.slice(12)) * 1000).toISOString();
    else if (l.startsWith("summary ")) m.summary = l.slice(8);
    else if (l.startsWith("\t")) {
      const uncommitted = ZERO.test(cur.sha);
      lines.push({ line: cur.line, sha: cur.sha, author: uncommitted ? "" : m.author, date: uncommitted ? "" : m.date, summary: uncommitted ? "" : m.summary, uncommitted });
      cur = undefined;
    }
  }
  return { engine: "git", lines };
}
