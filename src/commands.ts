import { resolve } from "node:path";
import { bool, fieldsOf, maxPositionals, parseArgs, str, strs, type FlagSpec, type Parsed } from "./args.js";
import { butJson, runBut, butError } from "./but.js";
import { AxiError } from "./errors.js";
import {
  ago,
  body,
  filterLines,
  filterRows,
  plural,
  project,
  putList,
  subject,
  tildify,
  truncate,
  truncationHint,
  validateFields,
  type ListSchema,
  type Output,
  type Row,
} from "./format.js";
import { loadWorkspace, workspaceBlock, type Workspace } from "./workspace.js";

export const DESCRIPTION = "Agent-ergonomic GitButler CLI that wraps `but --json` with compact TOON views and combined actions";

export const HOME_BRANCHES = 12;
export const LIMITS = { patch: 3000, body: 800, commits: 20, oplog: 10 };

export interface Ctx {
  cwd: string;
  /** Raw -C value the caller used, carried forward into help[] templates. */
  cwdFlag?: string;
  p: Parsed;
  fields: string[];
  full: boolean;
  query?: string;
}

/** Build a help template: `Run \`but-axi [-C <dir>] <rest>\``. */
export function run(ctx: Pick<Ctx, "cwdFlag">, rest: string, why?: string): string {
  const pre = ctx.cwdFlag ? `but-axi -C ${quoteArg(ctx.cwdFlag)} ` : "but-axi ";
  return `Run \`${pre}${rest}\`${why ? ` ${why}` : ""}`;
}

function quoteArg(s: string): string {
  return /^[\w./~@:+-]+$/.test(s) ? s : `'${s.replace(/'/g, "'\\''")}'`;
}

export function makeCtx(argv: string[], spec: FlagSpec, cmd: string): Ctx {
  const p = parseArgs(argv, spec, cmd);
  const cwdFlag = str(p, "cwd");
  return {
    cwd: resolve(cwdFlag ?? process.cwd()),
    cwdFlag,
    p,
    fields: fieldsOf(p),
    full: bool(p, "full"),
    query: str(p, "query"),
  };
}

function queryNote(data: Row, ctx: Ctx, matched: number, total: number, noun: string, nouns = noun + "s"): void {
  if (!ctx.query) return;
  data.query = ctx.query;
  data.matched = `${matched} of ${total} ${total === 1 ? noun : nouns}`;
}

/* ---------------------------------------------------------------- home */

export function homeHelp(ws: Workspace, ctx: Pick<Ctx, "cwdFlag">): string[] {
  const help: string[] = [];
  if (ws.conflicts > 0) help.push(`Run \`but resolve conflicts <branch>\` to resolve ${plural(ws.conflicts, "conflict")} (raw but)`);
  if (ws.uncommitted.length > 0) {
    help.push(run(ctx, "diff", `to inspect ${ws.uncommitted.length} uncommitted`));
    help.push(run(ctx, `commit -b <branch> -m "<message>"`));
  }
  if (ws.branches.some((b) => b.commits > 0 && (b.state === "unpushed" || b.state === "ahead"))) help.push(run(ctx, "push <branch>"));
  if (ws.branches.length === 0 && ws.uncommitted.length === 0) help.push(run(ctx, "branch new <name>"));
  if (ws.behind > 0) help.push("Run `but pull` to update applied branches (raw but)");
  help.push(run(ctx, "status", "for IDs, files and commits"));
  help.push(run(ctx, "--help", "for all commands"));
  return help;
}

export function homeView(ctx: Ctx, bin: string): Output {
  const data: Row = { bin: tildify(bin), description: DESCRIPTION };
  let ws: Workspace;
  try {
    ws = loadWorkspace(ctx.cwd);
  } catch (e) {
    if (e instanceof AxiError && e.code === "NOT_A_WORKSPACE") {
      data.workspace = `none — ${tildify(ctx.cwd)} is not a GitButler workspace`;
      return {
        data,
        help: ["Run `but setup` inside a git repo to enable GitButler (raw but)", run(ctx, "-C <path>", "to view another workspace"), run(ctx, "--help")],
      };
    }
    throw e;
  }
  workspaceBlock(ws, data);
  const rows = data.branches;
  if (Array.isArray(rows) && rows.length > HOME_BRANCHES) {
    data.branches = rows.slice(0, HOME_BRANCHES);
    data.branches_note = `(showing ${HOME_BRANCHES} of ${rows.length} — run \`but-axi status\` for all)`;
  }
  return { data, help: homeHelp(ws, ctx) };
}

/* ---------------------------------------------------------------- status */

const UNCOMMITTED: ListSchema = { name: "uncommitted", defaults: ["id", "path", "change"], extras: ["branch", "conflicted"] };
const BRANCHES: ListSchema = { name: "branches", defaults: ["id", "name", "commits", "state"], extras: ["stack", "upstream", "review", "conflicts"] };
const COMMITS: ListSchema = { name: "commits", defaults: ["id", "branch", "subject"], extras: ["sha", "author", "date", "conflicted", "changeId"] };

export function statusView(ctx: Ctx, ws?: Workspace): Output {
  validateFields(ctx.fields, [UNCOMMITTED, BRANCHES, COMMITS], "status");
  ws ??= loadWorkspace(ctx.cwd);
  const data: Row = { workspace: tildify(ws.root), count: "" };
  const unc = filterRows(ws.uncommitted, ctx.query);
  const br = filterRows(ws.branches, ctx.query);
  const cm = filterRows(ws.commits, ctx.query);
  data.count = `${plural(ws.branches.length, "branch", "branches")}; ${plural(ws.commits.length, "commit")}; ${ws.uncommitted.length} uncommitted; ${plural(ws.conflicts, "conflict")}`;
  data.upstream = ws.behind > 0 ? `behind ${ws.behind} (run \`but pull\` to update)` : "up to date";
  if (ctx.query) {
    data.query = ctx.query;
    data.matched = `${unc.length} uncommitted; ${br.length} branches; ${cm.length} commits`;
  }
  const none = (noun: string) => (ctx.query ? `0 matching ${noun}` : `0 ${noun}`);
  putList(data, "uncommitted", project(unc, UNCOMMITTED, ctx.fields), none("uncommitted changes"));
  putList(data, "branches", project(br, BRANCHES, ctx.fields), none("applied branches"));
  const shown = ctx.full ? cm : cm.slice(0, LIMITS.commits);
  putList(data, "commits", project(shown, COMMITS, ctx.fields), none("commits on applied branches"));
  if (shown.length < cm.length) data.commits_note = `(showing ${shown.length} of ${cm.length} — use --full to see all commits)`;
  const help: string[] = [];
  if (ws.uncommitted.length) help.push(run(ctx, "diff <id>"), run(ctx, `commit -b <branch> -m "<message>" <id>...`));
  if (ws.commits.length) help.push(run(ctx, "show <commit-id>"));
  if (ws.branches.some((b) => b.commits > 0 && (b.state === "unpushed" || b.state === "ahead"))) help.push(run(ctx, "push <branch>"));
  if (!ws.commits.length && !ws.uncommitted.length) help.push(run(ctx, "branch new <name>"));
  if (ws.conflicts) help.push("Run `but resolve conflicts <branch>` (raw but)");
  return { data, help };
}

/* ---------------------------------------------------------------- diff */

interface RawHunk { diff?: string; oldStart?: number; oldLines?: number; newStart?: number; newLines?: number }
interface RawDiffChange { id?: string; path: string; status?: string; diff?: { type?: string; hunks?: RawHunk[] } }

const HUNKS: ListSchema = { name: "hunks", defaults: ["id", "path", "status", "lines"], extras: ["range"] };

/** `but diff --json` returns one entry per hunk (id `<file>:<hunk>`) for uncommitted changes, one per file for commits. */
export function diffView(ctx: Ctx): Output {
  maxPositionals(ctx.p, 1, "diff");
  validateFields(ctx.fields, [HUNKS], "diff");
  const target = ctx.p.positionals[0];
  const raw = butJson<{ changes?: RawDiffChange[] }>(["diff", ...(target ? [target] : [])], ctx.cwd);
  const changes = raw.changes ?? [];
  let adds = 0;
  let dels = 0;
  const rows: Row[] = [];
  for (const c of changes) {
    const hunks = c.diff?.hunks ?? [];
    const type = c.diff?.type && c.diff.type !== "patch" ? c.diff.type : "";
    if (hunks.length === 0) {
      rows.push({ id: c.id ?? "", path: c.path, status: c.status ?? "", lines: type || "+0 -0", range: "", _text: "", _type: type });
      continue;
    }
    for (const h of hunks) {
      const text = h.diff ?? "";
      let a = 0;
      let d = 0;
      for (const line of text.split("\n")) {
        if (line.startsWith("+")) a++;
        else if (line.startsWith("-")) d++;
      }
      adds += a;
      dels += d;
      const range = h.oldStart !== undefined ? `-${h.oldStart},${h.oldLines ?? 0} +${h.newStart ?? 0},${h.newLines ?? 0}` : "";
      rows.push({ id: c.id ?? "", path: c.path, status: c.status ?? "", lines: `+${a} -${d}`, range, _text: text, _type: type });
    }
  }
  const q = ctx.query?.toLowerCase();
  const matched = q ? rows.filter((r) => String(r.path).toLowerCase().includes(q) || String(r._text).toLowerCase().includes(q)) : rows;
  const files = new Set(rows.map((r) => r.path)).size;
  const data: Row = {
    target: target ?? "uncommitted changes",
    count: `${plural(files, "file")}; ${plural(rows.length, "hunk")}; +${adds} -${dels}`,
  };
  queryNote(data, ctx, matched.length, rows.length, "hunk");
  putList(data, "hunks", project(matched, HUNKS, ctx.fields), ctx.query ? "0 matching hunks" : target ? `0 changes in ${target}` : "0 uncommitted changes");
  if (matched.length) {
    let patch = "";
    let last = "";
    for (const r of matched) {
      if (r.path !== last) {
        patch += `--- ${r.path}${r._type ? ` (${r._type})` : ""}\n`;
        last = String(r.path);
      }
      patch += String(r._text);
    }
    patch = patch.trimEnd();
    if (ctx.query) patch = filterLines(patch, ctx.query);
    const t = truncate(patch, LIMITS.patch, ctx.full);
    data.patch = t.text;
    if (t.truncated) data.patch_note = truncationHint(t.total, "diff");
  }
  const help: string[] = [];
  if (!target && changes.length) help.push(run(ctx, `commit -b <branch> -m "<message>" <id>...`, "to commit selected hunks/files"));
  if (data.patch_note) help.push(run(ctx, `diff ${target ? target + " " : ""}--full`), run(ctx, `diff <id> --query <text>`));
  if (!changes.length) help.push(run(ctx, "status"));
  return { data, help };
}

/* ---------------------------------------------------------------- show */

interface RawShowCommit {
  commit: string;
  changeId?: string;
  author?: { name?: string; email?: string };
  date?: string;
  message?: string;
  files?: { path: string; status?: string }[];
}
interface RawShowBranch {
  branch: string;
  commits?: { sha: string; short_sha?: string; cli_id?: string | null; message?: string; full_message?: string | null; author_name?: string; timestamp?: number; files_changed?: number | null; insertions?: number | null; deletions?: number | null }[];
  stackedOn?: string[];
  baseCommit?: { short_sha?: string; message?: string };
  commitsAhead?: number;
}

const SHOW_FILES: ListSchema = { name: "files", defaults: ["path", "status"], extras: [] };
const SHOW_COMMITS: ListSchema = { name: "commits", defaults: ["id", "subject", "files"], extras: ["sha", "author", "when", "lines"] };

export function showView(ctx: Ctx, target?: string): Output {
  if (!target) {
    maxPositionals(ctx.p, 1, "show");
    target = ctx.p.positionals[0];
  }
  if (!target) throw new AxiError("show needs a commit id, change id, or branch name", "MISSING_ARGUMENT", [run(ctx, "show <commit-id|branch>"), run(ctx, "status", "to list IDs")]);
  validateFields(ctx.fields, [SHOW_FILES, SHOW_COMMITS], "show");
  const raw = butJson<RawShowCommit | RawShowBranch>(["show", target], ctx.cwd);
  if ("commit" in raw) {
    const c = raw;
    const files = filterRows((c.files ?? []).map((f) => ({ path: f.path, status: f.status ?? "" })), ctx.query);
    const data: Row = {
      commit: { id: c.changeId ? c.changeId.slice(0, 8) : c.commit.slice(0, 7), sha: c.commit.slice(0, 7), author: c.author?.name ?? "", date: c.date ?? "" },
      subject: subject(c.message),
    };
    const b = body(c.message);
    if (b) {
      const t = truncate(b, LIMITS.body, ctx.full);
      data.body = t.text;
      if (t.truncated) data.body_note = truncationHint(t.total, "commit message");
    }
    data.count = plural((c.files ?? []).length, "file");
    queryNote(data, ctx, files.length, (c.files ?? []).length, "file");
    putList(data, "files", project(files, SHOW_FILES, ctx.fields), ctx.query ? "0 matching files" : "0 files changed");
    return { data, help: [run(ctx, `diff ${target}`, "for the patch"), ...(data.body_note ? [run(ctx, `show ${target} --full`)] : [])] };
  }
  const b = raw as RawShowBranch;
  const all = (b.commits ?? []).map((c) => ({
    id: c.cli_id || c.short_sha || c.sha.slice(0, 7),
    sha: c.short_sha ?? c.sha.slice(0, 7),
    subject: subject(c.message ?? c.full_message),
    files: c.files_changed ?? "",
    author: c.author_name ?? "",
    when: c.timestamp ? ago(c.timestamp * 1000) : "",
    lines: c.insertions !== null && c.insertions !== undefined ? `+${c.insertions} -${c.deletions ?? 0}` : "",
  }));
  const rows = filterRows(all, ctx.query);
  const shown = ctx.full ? rows : rows.slice(0, LIMITS.commits);
  const data: Row = {
    branch: b.branch,
    count: plural(all.length, "commit"),
    base: b.baseCommit ? `${b.baseCommit.short_sha ?? ""} ${subject(b.baseCommit.message)}`.trim() : "",
  };
  if (b.stackedOn?.length) data.stackedOn = b.stackedOn;
  queryNote(data, ctx, rows.length, all.length, "commit");
  putList(data, "commits", project(shown, SHOW_COMMITS, ctx.fields), ctx.query ? "0 matching commits" : "0 commits ahead of base");
  if (shown.length < rows.length) data.commits_note = `(showing ${shown.length} of ${rows.length} — use --full to see all commits)`;
  return { data, help: [run(ctx, "show <commit-id>"), run(ctx, `push ${b.branch}`)] };
}

/* ---------------------------------------------------------------- branch */

interface RawBranchList {
  appliedStacks?: { id?: string; heads?: { name: string; lastCommitAt?: number; lastAuthor?: { name?: string }; mergesCleanly?: boolean; reviews?: unknown[] }[] }[];
  branches?: { name: string; hasLocal?: boolean; lastCommitAt?: number; lastAuthor?: { name?: string }; mergesCleanly?: boolean; reviews?: unknown[] }[];
  hasMoreBranches?: boolean;
}
const BRANCH_LIST: ListSchema = { name: "branches", defaults: ["name", "applied", "updated"], extras: ["author", "mergesCleanly", "local", "reviews"] };

export function branchList(ctx: Ctx): Output {
  validateFields(ctx.fields, [BRANCH_LIST], "branch");
  const raw = butJson<RawBranchList>(["branch", "list"], ctx.cwd);
  const all: Row[] = [];
  for (const s of raw.appliedStacks ?? []) for (const h of s.heads ?? []) all.push({ name: h.name, applied: true, updated: ago(h.lastCommitAt), author: h.lastAuthor?.name ?? "", mergesCleanly: h.mergesCleanly ?? "", local: true, reviews: (h.reviews ?? []).length });
  for (const h of raw.branches ?? []) all.push({ name: h.name, applied: false, updated: ago(h.lastCommitAt), author: h.lastAuthor?.name ?? "", mergesCleanly: h.mergesCleanly ?? "", local: h.hasLocal ?? "", reviews: (h.reviews ?? []).length });
  const rows = filterRows(all, ctx.query);
  const applied = all.filter((r) => r.applied).length;
  const data: Row = { count: `${applied} applied; ${all.length - applied} unapplied${raw.hasMoreBranches ? " (more exist; use raw `but branch list --all`)" : ""}` };
  queryNote(data, ctx, rows.length, all.length, "branch", "branches");
  putList(data, "branches", project(rows, BRANCH_LIST, ctx.fields), ctx.query ? "0 matching branches" : "0 branches");
  return { data, help: [run(ctx, "show <branch>"), run(ctx, "branch new <name>"), "Run `but apply <branch>` to apply an unapplied branch (raw but)"] };
}

export function branchNew(ctx: Ctx): Output {
  maxPositionals(ctx.p, 1, "branch new");
  const name = ctx.p.positionals[0];
  if (!name) throw new AxiError("branch new needs a <name>", "MISSING_ARGUMENT", [run(ctx, "branch new <name>")]);
  const above = str(ctx.p, "above");
  const below = str(ctx.p, "below");
  const args = ["branch", "new", name, ...(above ? ["--above", above] : []), ...(below ? ["--below", below] : [])];
  const r = runBut(args, ctx.cwd);
  let result: string;
  if (r.code === 0) result = `created ${name}${above ? ` above ${above}` : ""}${below ? ` below ${below}` : ""}`;
  else if (/already (applied|exists)/i.test(r.stderr + r.stdout)) result = `${name} already exists (no change)`;
  else throw butError(r, args);
  const ws = loadWorkspace(ctx.cwd);
  const data: Row = { branch: result };
  workspaceBlock(ws, data);
  return { data, help: [run(ctx, `commit -b ${name} -m "<message>"`), run(ctx, "diff")] };
}

/* ---------------------------------------------------------------- commit */

export function commit(ctx: Ctx): Output {
  const messages = strs(ctx.p, "message");
  const branch = str(ctx.p, "branch");
  const changes = ctx.p.positionals;
  if (messages.length === 0) {
    throw new AxiError("commit needs -m <message> (but-axi never opens an editor)", "MISSING_MESSAGE", [run(ctx, `commit${branch ? ` -b ${branch}` : " -b <branch>"} -m "<message>"`)]);
  }
  const before = loadWorkspace(ctx.cwd);
  if (changes.length === 0 && before.uncommitted.length === 0) {
    const data: Row = { commit: "skipped — nothing to commit (0 uncommitted changes)" };
    workspaceBlock(before, data);
    return { data, help: [run(ctx, "status"), run(ctx, "push <branch>")] };
  }
  const args = ["commit", ...changes, ...messages.flatMap((m) => ["-m", m]), ...(branch ? ["-b", branch] : [])];
  let res: { commitId?: string; changeId?: string };
  try {
    res = butJson(args, ctx.cwd);
  } catch (e) {
    if (e instanceof AxiError && !branch && /branch|stack|--above|--below/i.test(e.message)) {
      e.help.unshift(run(ctx, `commit -b <branch> -m "<message>"${changes.length ? " " + changes.join(" ") : ""}`));
    }
    throw e;
  }
  const after = loadWorkspace(ctx.cwd);
  const sha = res.commitId ?? "";
  const made = after.commits.find((c) => sha && c.sha === sha.slice(0, 7));
  const data: Row = {
    committed: {
      id: made?.id ?? (res.changeId ?? "").slice(0, 8),
      sha: sha.slice(0, 7),
      branch: made?.branch ?? branch ?? "",
      subject: subject(messages.join("\n\n")),
    },
  };
  workspaceBlock(after, data);
  const target = made?.branch ?? branch ?? "<branch>";
  const help = [run(ctx, `push ${target}`), run(ctx, `show ${made?.id ?? "<commit-id>"}`), run(ctx, "undo", "to revert this commit")];
  if (after.uncommitted.length) help.unshift(run(ctx, "diff", `(${after.uncommitted.length} still uncommitted)`));
  return { data, help };
}

/* ---------------------------------------------------------------- push */

interface RawPushOne { remote?: string; branchShaUpdates?: [string, string, string][] }
/** Single-branch push returns RawPushOne; push-all returns { pushed: RawPushOne[], failed: [...] }. */
interface RawPush extends RawPushOne { pushed?: RawPushOne[]; failed?: unknown[] }
interface RawPushDry { branches?: { branchName: string; unpushedCommits?: number; remote?: string; requiresForce?: boolean }[] }

export function push(ctx: Ctx): Output {
  maxPositionals(ctx.p, 1, "push");
  const branch = ctx.p.positionals[0];
  const dry = bool(ctx.p, "dry-run");
  const force = bool(ctx.p, "with-force");
  const extra = [...(force ? ["--with-force"] : []), ...(bool(ctx.p, "no-verify") ? ["--no-verify"] : [])];
  if (dry) {
    const raw = butJson<RawPushDry>(["push", ...(branch ? [branch] : []), "--dry-run", ...extra], ctx.cwd);
    const rows = (raw.branches ?? []).map((b) => ({ branch: b.branchName, commits: b.unpushedCommits ?? 0, remote: b.remote ?? "", force: !!b.requiresForce }));
    const data: Row = { dry_run: true, count: `${plural(rows.length, "branch", "branches")} would be pushed` };
    putList(data, "would_push", rows, "0 branches — nothing to push");
    return { data, help: rows.length ? [run(ctx, `push ${branch ?? "<branch>"}`)] : [run(ctx, "status")] };
  }
  const raw = butJson<RawPush>(["push", ...(branch ? [branch] : []), ...extra], ctx.cwd);
  const results: RawPushOne[] = Array.isArray(raw.pushed) ? raw.pushed : [raw];
  const pushed = results.flatMap((res) =>
    (res.branchShaUpdates ?? [])
      .filter(([, from, to]) => from !== to)
      .map(([name, from, to]) => ({ branch: name, remote: res.remote ?? "", from: /^0+$/.test(from) ? "(new)" : from.slice(0, 7), to: to.slice(0, 7) })),
  );
  const failed = Array.isArray(raw.failed) ? raw.failed : [];
  if (failed.length) {
    throw new AxiError(
      `push failed for ${plural(failed.length, "branch", "branches")}: ${JSON.stringify(failed).slice(0, 400)}${pushed.length ? `; pushed ok: ${pushed.map((p) => p.branch).join(" ")}` : ""}`,
      "PUSH_FAILED",
      [run(ctx, "push <branch> --dry-run"), "Run `but push <branch>` for raw output"],
    );
  }
  const data: Row = {
    result: pushed.length ? `pushed ${plural(pushed.length, "branch", "branches")}` : "pushed 0 branches (already up to date)",
  };
  if (pushed.length) data.pushed = pushed;
  workspaceBlock(loadWorkspace(ctx.cwd), data);
  return { data, help: ["Run `but pr new <branch> -m \"<title>\"` to open a PR (raw but)", run(ctx, "status")] };
}

/* ---------------------------------------------------------------- undo / redo / oplog */

export function undoRedo(ctx: Ctx, action: "undo" | "redo"): Output {
  maxPositionals(ctx.p, 0, action);
  const res = butJson<{ changed?: boolean; snapshotId?: string }>([action], ctx.cwd);
  const ws = loadWorkspace(ctx.cwd);
  const data: Row = {
    [action]: res.changed === false ? `nothing to ${action} (no change)` : `restored${res.snapshotId ? ` (snapshot ${res.snapshotId.slice(0, 8)})` : ""}`,
  };
  workspaceBlock(ws, data);
  return { data, help: [run(ctx, action === "undo" ? "redo" : "undo"), run(ctx, "oplog"), run(ctx, "status")] };
}

interface RawOp { id: string; createdAt?: number; details?: { operation?: string; title?: string; body?: string | null } }
const OPS: ListSchema = { name: "ops", defaults: ["id", "operation", "when"], extras: ["title", "body", "sha"] };

export function oplogList(ctx: Ctx): Output {
  validateFields(ctx.fields, [OPS], "oplog");
  const limitRaw = str(ctx.p, "limit");
  const limit = limitRaw ? Number(limitRaw) : LIMITS.oplog;
  if (!Number.isInteger(limit) || limit < 1) throw new AxiError(`--limit must be a positive integer, got "${limitRaw}"`, "INVALID_VALUE", [run(ctx, "oplog --limit 20")]);
  const raw = butJson<RawOp[]>(["oplog", "list"], ctx.cwd);
  const all = (Array.isArray(raw) ? raw : []).map((o) => ({
    id: o.id.slice(0, 8),
    sha: o.id,
    operation: o.details?.operation ?? "",
    when: ago(o.createdAt),
    title: o.details?.title ?? "",
    body: o.details?.body ?? "",
  }));
  const rows = filterRows(all, ctx.query);
  const shown = ctx.full ? rows : rows.slice(0, limit);
  const data: Row = { count: `showing ${shown.length} of ${plural(all.length, "operation")}${all.length >= 20 ? " (but returns the most recent 20)" : ""}` };
  queryNote(data, ctx, rows.length, all.length, "operation");
  putList(data, "ops", project(shown, OPS, ctx.fields), ctx.query ? "0 matching operations" : "0 operations recorded");
  return { data, help: [run(ctx, "undo", "to revert the latest operation"), run(ctx, "oplog restore <id>"), run(ctx, `oplog snapshot -m "<message>"`)] };
}

export function oplogSnapshot(ctx: Ctx): Output {
  maxPositionals(ctx.p, 0, "oplog snapshot");
  const msg = str(ctx.p, "message");
  const res = butJson<Record<string, unknown>>(["oplog", "snapshot", ...(msg ? ["-m", msg] : [])], ctx.cwd);
  const id = String(res.snapshot_id ?? res.snapshotId ?? res.id ?? "");
  return { data: { snapshot: id ? `created ${id.slice(0, 8)}` : "created", message: msg ?? "" }, help: [run(ctx, `oplog restore ${id ? id.slice(0, 8) : "<id>"}`), run(ctx, "oplog")] };
}

export function oplogRestore(ctx: Ctx): Output {
  maxPositionals(ctx.p, 1, "oplog restore");
  const id = ctx.p.positionals[0];
  if (!id) throw new AxiError("oplog restore needs an <id>", "MISSING_ARGUMENT", [run(ctx, "oplog", "to list ids"), run(ctx, "oplog restore <id>")]);
  butJson(["oplog", "restore", id], ctx.cwd);
  const ws = loadWorkspace(ctx.cwd);
  const data: Row = { restored: id };
  workspaceBlock(ws, data);
  return { data, help: [run(ctx, "undo", "to undo the restore"), run(ctx, "status")] };
}
