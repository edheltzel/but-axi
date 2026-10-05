import { spawnSync } from "node:child_process";
import { butJson } from "./but.js";
import { plural, putList, subject, tildify, type Row } from "./format.js";

/* Raw shapes from `but status --json` (GitButler CLI 0.22.x). */
interface RawCommit {
  cliId?: string;
  changeId?: string;
  commitId: string;
  createdAt?: string;
  message?: string;
  authorName?: string;
  authorEmail?: string;
  conflicted?: boolean | null;
}
interface RawBranch {
  cliId?: string;
  name: string;
  commits?: RawCommit[];
  upstreamCommits?: RawCommit[];
  branchStatus?: string;
  reviewId?: string | number | null;
  ci?: unknown;
}
interface RawChange {
  cliId?: string;
  filePath: string;
  changeType?: string;
  conflicted?: boolean;
}
interface RawStack {
  cliId?: string;
  assignedChanges?: RawChange[];
  branches?: RawBranch[];
}
export interface RawStatus {
  uncommittedChanges?: RawChange[];
  stacks?: RawStack[];
  mergeBase?: RawCommit;
  upstreamState?: { behind?: number; latestCommit?: RawCommit; lastFetched?: string };
}

export interface Change extends Row {
  id: string;
  path: string;
  change: string;
  branch: string;
  conflicted: boolean;
}
export interface Branch extends Row {
  id: string;
  name: string;
  commits: number;
  state: string;
  stack: string;
  upstream: number;
  review: string;
  conflicts: number;
}
export interface Commit extends Row {
  id: string;
  sha: string;
  branch: string;
  subject: string;
  author: string;
  date: string;
  conflicted: boolean;
  changeId: string;
  message: string;
}

export interface Workspace {
  cwd: string;
  root: string;
  uncommitted: Change[];
  branches: Branch[];
  commits: Commit[];
  stacks: number;
  conflicts: number;
  behind: number;
  base: { sha: string; subject: string };
}

const STATE: Record<string, string> = {
  completelyUnpushed: "unpushed",
  nothingToPush: "pushed",
  unpushedCommits: "ahead",
  unpushedCommitsRequiringForce: "needs-force",
  integrated: "integrated",
};

export function mapState(s: string | undefined): string {
  if (!s) return "unknown";
  return STATE[s] ?? s;
}

export function gitRoot(cwd: string): string {
  const r = spawnSync("git", ["-C", cwd, "rev-parse", "--show-toplevel"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  return r.status === 0 ? r.stdout.trim() : cwd;
}

/** Pure transform of `but status --json` into the compact workspace model. */
export function summarize(raw: RawStatus, cwd: string, root: string): Workspace {
  const uncommitted: Change[] = [];
  for (const c of raw.uncommittedChanges ?? []) {
    uncommitted.push({ id: c.cliId ?? "", path: c.filePath, change: c.changeType ?? "", branch: "", conflicted: !!c.conflicted });
  }
  const branches: Branch[] = [];
  const commits: Commit[] = [];
  let stackIdx = 0;
  for (const s of raw.stacks ?? []) {
    stackIdx++;
    for (const c of s.assignedChanges ?? []) {
      uncommitted.push({
        id: c.cliId ?? "",
        path: c.filePath,
        change: c.changeType ?? "",
        branch: s.branches?.[0]?.name ?? "",
        conflicted: !!c.conflicted,
      });
    }
    for (const b of s.branches ?? []) {
      const bc = b.commits ?? [];
      const conflicts = bc.filter((c) => c.conflicted === true).length;
      branches.push({
        id: b.cliId ?? "",
        name: b.name,
        commits: bc.length,
        state: mapState(b.branchStatus),
        stack: s.cliId ?? String(stackIdx),
        upstream: (b.upstreamCommits ?? []).length,
        review: b.reviewId === null || b.reviewId === undefined ? "" : String(b.reviewId),
        conflicts,
      });
      for (const c of bc) {
        commits.push({
          id: c.cliId || c.commitId.slice(0, 7),
          sha: c.commitId.slice(0, 7),
          branch: b.name,
          subject: subject(c.message),
          author: c.authorName ?? "",
          date: c.createdAt ?? "",
          conflicted: c.conflicted === true,
          changeId: c.changeId ?? "",
          message: c.message ?? "",
        });
      }
    }
  }
  const conflicts = commits.filter((c) => c.conflicted).length + uncommitted.filter((c) => c.conflicted).length;
  return {
    cwd,
    root,
    uncommitted,
    branches,
    commits,
    stacks: (raw.stacks ?? []).length,
    conflicts,
    behind: raw.upstreamState?.behind ?? 0,
    base: { sha: (raw.mergeBase?.commitId ?? "").slice(0, 7), subject: subject(raw.mergeBase?.message) },
  };
}

export function loadWorkspace(cwd: string): Workspace {
  const raw = butJson<RawStatus>(["status"], cwd);
  return summarize(raw, cwd, gitRoot(cwd));
}

/** Compact one-line aggregate: `2 stacks; 3 branches; 5 commits (4 on unpushed branches); 7 uncommitted; 0 conflicts`. */
export function aggregate(ws: Workspace): string {
  const unpushedBranches = new Set(ws.branches.filter((b) => b.state !== "pushed" && b.state !== "integrated").map((b) => b.name));
  const unpushed = ws.commits.filter((c) => unpushedBranches.has(c.branch)).length;
  return [
    plural(ws.stacks, "stack"),
    plural(ws.branches.length, "branch", "branches"),
    `${plural(ws.commits.length, "commit")}${ws.commits.length ? ` (${unpushed} on unpushed branches)` : ""}`,
    `${ws.uncommitted.length} uncommitted`,
    plural(ws.conflicts, "conflict"),
  ].join("; ");
}

/** Shared workspace block used by home, status and every mutation result. */
export function workspaceBlock(ws: Workspace, data: Row = {}): Row {
  data.workspace = tildify(ws.root);
  data.count = aggregate(ws);
  data.upstream = ws.behind > 0 ? `behind ${ws.behind} (run \`but pull\` to update)` : "up to date";
  putList(
    data,
    `branches`,
    ws.branches.map((b) => ({ name: b.name, commits: b.commits, state: b.state })),
    "0 applied branches",
  );
  return data;
}
