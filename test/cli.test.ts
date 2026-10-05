import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it, beforeAll } from "vitest";

const BIN = resolve(__dirname, "..", "dist", "bin", "but-axi.js");

function axi(args: string[], opts: { cwd?: string; env?: Record<string, string>; input?: string } = {}) {
  const r = spawnSync(process.execPath, [BIN, ...args], {
    cwd: opts.cwd ?? tmpdir(),
    encoding: "utf8",
    input: opts.input ?? "",
    env: { ...process.env, ...opts.env },
    timeout: 120_000,
  });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

function fakeBut(script: string): string {
  const dir = mkdtempSync(join(tmpdir(), "fake-but-"));
  const p = join(dir, "but");
  writeFileSync(p, `#!/bin/sh\n${script}\n`);
  chmodSync(p, 0o755);
  return p;
}

describe("exit codes and structured errors (fake but)", () => {
  it("unknown command => exit 2 with help[]", () => {
    const r = axi(["frobnicate"]);
    expect(r.code).toBe(2);
    expect(r.out).toMatch(/^error: unknown command frobnicate\ncode: UNKNOWN_COMMAND\nhelp\[1\]:/);
  });
  it("raw-but command names point to raw but", () => {
    const r = axi(["squash"]);
    expect(r.code).toBe(2);
    expect(r.out).toContain("run raw `but squash --help`");
  });
  it("unknown flag => exit 2", () => {
    const r = axi(["status", "--bogus"]);
    expect(r.code).toBe(2);
    expect(r.out).toContain("error: unknown flag --bogus");
  });
  it("unknown flag on --help still fails loud", () => {
    expect(axi(["status", "--help", "--nope"]).code).toBe(2);
  });
  it("per-command --help is concise and exit 0", () => {
    const r = axi(["commit", "--help"]);
    expect(r.code).toBe(0);
    expect(r.out.startsWith("usage: but-axi commit")).toBe(true);
    expect(r.out.split("\n").length).toBeLessThan(10);
  });
  it("but JSON error => exit 1, error on stdout, nothing on stderr", () => {
    const but = fakeBut(`echo '{"error":"setup_required","message":"No GitButler project found at /x","hint":"run but setup"}'; echo 'Error: Setup required' >&2; exit 1`);
    const r = axi(["status"], { env: { BUT_AXI_BUT: but } });
    expect(r.code).toBe(1);
    expect(r.out).toContain("error: No GitButler project found at /x");
    expect(r.out).toContain("code: NOT_A_WORKSPACE");
    expect(r.err).toBe("");
  });
  it("but text error => exit 1 with deduped message", () => {
    const but = fakeBut(`echo "Commit 'nope' not found Commit 'nope' not found" >&2; exit 1`);
    const r = axi(["show", "nope"], { env: { BUT_AXI_BUT: but } });
    expect(r.code).toBe(1);
    expect(r.out).toContain("error: Commit 'nope' not found\n");
  });
  it("missing but binary => exit 1 BUT_NOT_FOUND", () => {
    const r = axi(["status"], { env: { BUT_AXI_BUT: "/nonexistent/but" } });
    expect(r.code).toBe(1);
    expect(r.out).toContain("code: BUT_NOT_FOUND");
  });
  it("home outside a workspace is content-first, exit 0", () => {
    const but = fakeBut(`echo '{"error":"setup_required","message":"No GitButler project found","hint":"x"}'; exit 1`);
    const r = axi([], { env: { BUT_AXI_BUT: but } });
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/^bin: .*\ndescription: .+\nworkspace: none/);
  });
  it("hook session-start is silent outside a workspace", () => {
    const but = fakeBut(`exit 1`);
    const r = axi(["hook", "session-start"], { env: { BUT_AXI_BUT: but } });
    expect(r.code).toBe(0);
    expect(r.out).toBe("");
    const c = axi(["hook", "session-start", "--agent", "cursor"], { env: { BUT_AXI_BUT: but } });
    expect(c.out).toBe("{}\n");
  });
  it("debug logs go to stderr only", () => {
    const but = fakeBut(`echo '{"uncommittedChanges":[],"stacks":[]}'`);
    const r = axi(["status"], { env: { BUT_AXI_BUT: but, BUT_AXI_DEBUG: "1" } });
    expect(r.code).toBe(0);
    expect(r.err).toContain("[but-axi] exec");
    expect(r.out).not.toContain("[but-axi]");
    expect(r.out).toContain("uncommitted: 0 uncommitted changes");
  });
  it("unknown --fields => exit 2", () => {
    const but = fakeBut(`echo '{"uncommittedChanges":[],"stacks":[]}'`);
    const r = axi(["status", "--fields", "nope"], { env: { BUT_AXI_BUT: but } });
    expect(r.code).toBe(2);
    expect(r.out).toContain("code: UNKNOWN_FIELD");
  });
});

/* ------------------------------------------------------------ real but, throwaway repo */

const haveBut = spawnSync("but", ["--version"], { encoding: "utf8" }).status === 0;

describe.skipIf(!haveBut)("real GitButler workspace in /tmp", () => {
  let repo = "";
  const sh = (cmd: string, args: string[], cwd?: string) => {
    const r = spawnSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")}: ${r.stderr}`);
    return r.stdout;
  };
  beforeAll(() => {
    const base = mkdtempSync(join("/tmp", "but-axi-test-"));
    repo = join(base, "repo");
    const remote = join(base, "remote.git");
    sh("git", ["init", "-q", "--bare", remote]);
    sh("git", ["init", "-q", "-b", "main", repo]);
    writeFileSync(join(repo, "README.md"), "hello\n");
    sh("git", ["-C", repo, "add", "."]);
    sh("git", ["-C", repo, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "init"]);
    sh("git", ["-C", repo, "remote", "add", "origin", remote]);
    sh("git", ["-C", repo, "push", "-q", "origin", "main"]);
    sh("but", ["-C", repo, "setup"]);
  });

  it("home view shows workspace state and help", () => {
    const r = axi(["-C", repo]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("count: 0 stacks; 0 branches; 0 commits; 0 uncommitted; 0 conflicts");
    expect(r.out).toContain("branches: 0 applied branches");
    expect(r.out).toContain(`Run \`but-axi -C ${repo} branch new <name>\``);
  });

  it("commit flow: diff, commit, idempotent commit, branch new, push, undo", () => {
    writeFileSync(join(repo, "a.txt"), "line\n".repeat(1000));
    const d = axi(["diff"], { cwd: repo });
    expect(d.code).toBe(0);
    expect(d.out).toContain("count: 1 file; 1 hunk; +1000 -0");
    expect(d.out).toMatch(/patch_note: "?\(truncated, \d+ chars total — use --full to see complete diff\)/);
    expect(axi(["diff", "--full"], { cwd: repo }).out).not.toContain("patch_note");
    const dq = axi(["diff", "--query", "nomatch-xyz"], { cwd: repo });
    expect(dq.out).toContain("hunks: 0 matching hunks");
    expect(dq.out).toContain("matched: 0 of 1 hunk");

    const noMsg = axi(["commit", "-b", "feat"], { cwd: repo });
    expect(noMsg.code).toBe(1);
    expect(noMsg.out).toContain("code: MISSING_MESSAGE");

    const c = axi(["commit", "-b", "feat", "-m", "add a"], { cwd: repo });
    expect(c.code).toBe(0);
    expect(c.out).toMatch(/committed:\n  id: \S+\n  sha: [0-9a-f]{7}\n  branch: feat\n  subject: add a/);
    expect(c.out).toContain("branches[1]{name,commits,state}:\n  feat,1,unpushed");
    expect(c.out).toContain("Run `but-axi push feat`");

    const again = axi(["commit", "-b", "feat", "-m", "add a"], { cwd: repo });
    expect(again.code).toBe(0);
    expect(again.out).toContain("skipped — nothing to commit");

    const bn = axi(["branch", "new", "feat"], { cwd: repo });
    expect(bn.code).toBe(0);
    expect(bn.out).toContain("branch: feat already exists (no change)");

    const qs = axi(["status", "--query", "zzz-none"], { cwd: repo });
    expect(qs.out).toContain("commits: 0 matching commits on applied branches");

    const dry = axi(["push", "--dry-run"], { cwd: repo });
    expect(dry.out).toContain("would_push[1]{branch,commits,remote,force}:\n  feat,1,origin,false");

    const p1 = axi(["push", "feat"], { cwd: repo });
    expect(p1.code).toBe(0);
    expect(p1.out).toContain("result: pushed 1 branch");
    expect(p1.out).toMatch(/pushed\[1\]\{branch,remote,from,to\}:\n  feat,origin,\(new\),[0-9a-f]{7}/);
    expect(p1.out).toContain("feat,1,pushed");
    const p2 = axi(["push", "feat"], { cwd: repo });
    expect(p2.out).toContain("result: pushed 0 branches (already up to date)");

    writeFileSync(join(repo, "b.txt"), "b\n");
    expect(axi(["commit", "-m", "add b"], { cwd: repo }).code).toBe(0);
    const pAll = axi(["push"], { cwd: repo });
    expect(pAll.code).toBe(0);
    expect(pAll.out).toContain("result: pushed 1 branch");
    expect(pAll.out).toContain("feat,2,pushed");

    const snap = axi(["oplog", "snapshot", "-m", "checkpoint"], { cwd: repo });
    expect(snap.out).toMatch(/snapshot: created [0-9a-f]{8}/);

    const st = axi(["status", "--fields", "sha"], { cwd: repo });
    expect(st.out).toMatch(/commits\[2\]\{id,branch,subject,sha\}:/);
    const id = /commits\[2\]\{[^}]+\}:\n  (\S+?),/.exec(st.out)![1]!;
    const sh1 = axi(["show", id], { cwd: repo });
    expect(sh1.code).toBe(0);
    expect(sh1.out).toContain("subject: add b");
    expect(sh1.out).toContain("files[1]{path,status}:");

    const br = axi(["branch"], { cwd: repo });
    expect(br.out).toContain("count: 1 applied;");

    const ops = axi(["oplog", "--limit", "2"], { cwd: repo });
    expect(ops.out).toMatch(/ops\[2\]\{id,operation,when\}:/);

    const u = axi(["undo"], { cwd: repo });
    expect(u.code).toBe(0);
    expect(u.out).toMatch(/undo: restored/);

    const h = axi(["hook", "session-start"], { cwd: tmpdir(), input: JSON.stringify({ cwd: repo }) });
    expect(h.code).toBe(0);
    expect(h.out).toContain("description:");
    expect(h.out).toContain("branches");
  });
});
