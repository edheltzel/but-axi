import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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
  it("commands removed from but (open) are plain unknown commands", () => {
    const r = axi(["open"]);
    expect(r.code).toBe(2);
    expect(r.out).not.toContain("raw `but open");
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
  it("bare -V matches --version and does not load command handlers", () => {
    const pkg = JSON.parse(readFileSync(resolve(__dirname, "../package.json"), "utf8")).version as string;
    for (const flag of ["-V", "-v", "--version"]) {
      const r = axi([flag]);
      expect(r.code, flag).toBe(0);
      expect(r.out, flag).toBe(`${pkg}\n`);
      expect(r.err, flag).toBe("");
    }
    const src = readFileSync(resolve(__dirname, "../bin/but-axi.ts"), "utf8");
    expect(src).toContain('await import("../src/cli.js")');
    expect(src).not.toMatch(/import \{[^}]*\bmain\b[^}]*\} from "\.\.\/src\/cli\.js"/);
  });
  it("usage mistakes exit 2 instead of running or exiting 1", () => {
    const cases: [string[], string][] = [
      [["branch", "list", "--above", "feat"], "unexpected flag --above"],
      [["branch", "list", "--below", "feat"], "unexpected flag --below"],
      [["branch", "show", "--above", "feat", "name"], "unexpected flag --above"],
      [["branch", "show", "name", "extra"], "unexpected argument extra"],
      [["branch", "show"], "MISSING_ARGUMENT"],
      [["branch", "new"], "MISSING_ARGUMENT"],
      [["oplog", "list", "extra"], "unexpected argument extra"],
      [["oplog", "list", "-m", "hi"], "unexpected flag --message"],
      [["oplog", "snapshot", "--limit", "5"], "unexpected flag --limit"],
      [["oplog", "restore", "--limit", "3", "abc"], "unexpected flag --limit"],
      [["oplog", "restore", "-m", "hi", "abc"], "unexpected flag --message"],
      [["oplog", "--limit", "nope"], "INVALID_VALUE"],
      [["oplog", "restore"], "MISSING_ARGUMENT"],
      [["version", "extra"], "unexpected argument extra"],
      [["version", "-V"], ""],
      [["show"], "MISSING_ARGUMENT"],
      [["commit"], "MISSING_MESSAGE"],
      [["hook", "session-start", "--agent", "nope"], "unknown agent nope"],
    ];
    for (const [args, needle] of cases) {
      const r = axi(args);
      const label = args.join(" ");
      expect(r.code, label).toBe(needle ? 2 : 0);
      if (needle) expect(r.out, label).toContain(needle);
      expect(r.out, label).not.toContain("BUT_NOT_FOUND");
    }
  });
  it("branch list --query filters names; branch new --above is passed through", () => {
    const listed = fakeBut(`echo '{"appliedStacks":[{"heads":[{"name":"feat"},{"name":"other"}]}],"branches":[]}'`);
    const q = axi(["branch", "list", "--query", "feat"], { env: { BUT_AXI_BUT: listed } });
    expect(q.code).toBe(0);
    expect(q.out).toContain("query: feat");
    expect(q.out).toContain("feat,true");
    expect(q.out).not.toContain("other");
    const created = fakeBut(`
case "$*" in
  *status*) echo '{"uncommittedChanges":[],"stacks":[]}' ;;
  *) echo '{}' ;;
esac`);
    const n = axi(["branch", "new", "feat", "--above", "main"], { env: { BUT_AXI_BUT: created } });
    expect(n.code).toBe(0);
    expect(n.out).toContain("branch: created feat above main");
  });
  it("home --query filters applied branches", () => {
    const but = fakeBut(`echo '{"uncommittedChanges":[],"stacks":[{"branches":[{"name":"feat","commits":[],"branchStatus":"nothingToPush"},{"name":"other","commits":[],"branchStatus":"nothingToPush"}]}]}'`);
    const r = axi(["--query", "feat"], { env: { BUT_AXI_BUT: but } });
    expect(r.code).toBe(0);
    expect(r.out).toContain("query: feat");
    expect(r.out).toContain("matched: 1 of 2 branches");
    expect(r.out).toContain("feat,0,pushed");
    expect(r.out).not.toContain("other");
  });
  it("oplog snapshot returns the snapshot id and a compact workspace summary", () => {
    const but = fakeBut(`
case "$*" in
  *snapshot*) echo '{"snapshot_id":"abcdef0123456789"}' ;;
  *) echo '{"uncommittedChanges":[],"stacks":[{"branches":[{"name":"feat","commits":[],"branchStatus":"completelyUnpushed"}]}]}' ;;
esac`);
    const r = axi(["oplog", "snapshot", "-m", "checkpoint"], { env: { BUT_AXI_BUT: but } });
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/snapshot: created abcdef01/);
    expect(r.out).toContain("count: 1 stack; 1 branch; 0 commits; 0 uncommitted; 0 conflicts");
    expect(r.out).toContain("feat,0,unpushed");
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
    sh("git", ["-C", repo, "push", "-q", "-u", "origin", "main"]);
    sh("but", ["-C", repo, "config", "target", "main", "--push-remote", "origin"]);
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
    expect(noMsg.code).toBe(2);
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
    expect(snap.out).toContain("count:");

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

describe.skipIf(!haveBut)("real GitButler 0.23: hooks, worktrees, refused push", () => {
  const sh = (cmd: string, args: string[], cwd?: string) => {
    const r = spawnSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")}: ${r.stderr}`);
    return r.stdout;
  };
  const git = (cwd: string, ...a: string[]) => sh("git", ["-C", cwd, "-c", "user.name=t", "-c", "user.email=t@t", ...a]);

  it("maps hook failures, lists worktrees, reports refused pushes", () => {
    const base = mkdtempSync(join("/tmp", "but-axi-023-"));
    const repo = join(base, "repo");
    const remote = join(base, "remote.git");
    sh("git", ["init", "-q", "--bare", remote]);
    sh("git", ["init", "-q", "-b", "main", repo]);
    writeFileSync(join(repo, "a.txt"), "base\n");
    git(repo, "add", ".");
    git(repo, "commit", "-qm", "init");
    git(repo, "remote", "add", "origin", remote);
    git(repo, "push", "-q", "-u", "origin", "main");
    sh("but", ["-C", repo, "config", "target", "main", "--push-remote", "origin"]);

    const hook = join(repo, ".git", "hooks", "pre-commit");
    writeFileSync(hook, "#!/bin/sh\necho 'lint failed' >&2\nexit 1\n");
    chmodSync(hook, 0o755);
    writeFileSync(join(repo, "a.txt"), "mine\n");
    const failed = axi(["commit", "-b", "feat", "-m", "edit a"], { cwd: repo });
    expect(failed.code).toBe(1);
    expect(failed.out).toContain("code: HOOK_FAILED");
    expect(failed.out).toContain("lint failed");
    expect(failed.out).toContain("commit --no-hooks");
    expect(axi(["commit", "-n", "-b", "feat", "-m", "edit a", "-m", "- body starting with a dash"], { cwd: repo }).code).toBe(0);
    expect(spawnSync("git", ["-C", repo, "log", "-1", "--format=%B", "feat"], { encoding: "utf8" }).stdout).toContain("- body starting with a dash");

    const wt = `side-${base.slice(-6).toLowerCase()}`;
    const made = JSON.parse(sh("but", ["-C", repo, "worktree", "new", wt, "--json"])) as { path: string };
    try {
      const st = axi(["status"], { cwd: repo });
      expect(st.out).toContain("1 worktree");
      expect(st.out).toMatch(new RegExp(`worktrees\\[1\\]\\{id,name,commits,uncommitted,behind\\}:\\n  \\S+,${wt},0,0,0`));
    } finally {
      spawnSync("but", ["-C", repo, "worktree", "remove", made.path], { encoding: "utf8" });
    }

    const other = join(base, "other");
    sh("git", ["clone", "-q", "-b", "main", remote, other]);
    writeFileSync(join(other, "a.txt"), "theirs\n");
    git(other, "commit", "-qam", "theirs");
    git(other, "push", "-q", "origin", "main");
    spawnSync("but", ["-C", repo, "pull"], { encoding: "utf8" });
    const dry = axi(["push", "--dry-run"], { cwd: repo });
    expect(dry.code).toBe(1);
    expect(dry.out).toContain("code: PUSH_REFUSED");
    expect(dry.out).toMatch(/feat \(Cannot push branch 'feat'/);
    expect(dry.out).toContain("but resolve conflicts");
  });
});

const haveGrit = spawnSync("grit", ["--version"], { encoding: "utf8" }).status === 0;

describe("history: log and blame (grit when installed, else git)", () => {
  const git = (cwd: string, ...a: string[]) => {
    const r = spawnSync("git", ["-C", cwd, "-c", "user.name=t", "-c", "user.email=t@t", ...a], { encoding: "utf8" });
    if (r.status !== 0) throw new Error(r.stderr);
  };
  const repo = () => {
    const dir = mkdtempSync(join(tmpdir(), "but-axi-hist-"));
    git(dir, "init", "-q", "-b", "main");
    writeFileSync(join(dir, "f.txt"), "a\nb\n");
    git(dir, "add", ".");
    git(dir, "commit", "-qm", "one");
    writeFileSync(join(dir, "g.txt"), "g\n");
    git(dir, "add", ".");
    git(dir, "commit", "-qm", "two");
    writeFileSync(join(dir, "f.txt"), "a\nB\nc\n");
    return dir;
  };
  const engines = haveGrit ? [{}, { BUT_AXI_NO_GRIT: "1" }] : [{ BUT_AXI_NO_GRIT: "1" }];

  it.each(engines)("log and blame agree across engines (%o)", (env) => {
    const dir = repo();
    const log = axi(["log", "-n", "1"], { cwd: dir, env });
    expect(log.code).toBe(0);
    expect(log.out).toContain(`engine: ${env.BUT_AXI_NO_GRIT ? "git" : "grit"}`);
    expect(log.out).toMatch(/count: 1 commit \(more available — use --limit 2\)\ncommits\[1\]\{sha,subject,when\}:\n  "?[0-9a-f]{7}"?,two,/);
    const scoped = axi(["log", "--path", "f.txt", "--fields", "author"], { cwd: dir, env });
    expect(scoped.out).toMatch(/commits\[1\]\{sha,subject,when,author\}:\n  "?[0-9a-f]{7}"?,one,[^,]+,t/);
    const b = axi(["blame", "f.txt"], { cwd: dir, env });
    expect(b.code).toBe(0);
    expect(b.out).toContain("count: 3 lines; 1 commit; 2 uncommitted");
    expect(b.out).toMatch(/blame\[2\]\{lines,sha,author,summary\}:\n  "?1"?,"?[0-9a-f]{7}"?,t,one\n  2-3,uncommitted,"",""/);
    const missing = axi(["blame", "nope.txt"], { cwd: dir, env });
    expect(missing.code).toBe(1);
    expect(missing.out).toContain("error:");
  });

  it("usage errors exit 2 before running any engine", () => {
    expect(axi(["blame"]).code).toBe(2);
    expect(axi(["blame", "f", "-L", "x"]).out).toContain("code: INVALID_VALUE");
    expect(axi(["log", "--limit", "0"]).code).toBe(2);
    expect(axi(["log", "a", "b"]).code).toBe(2);
    const victim = join(mkdtempSync(join(tmpdir(), "but-axi-rev-")), "keep.txt");
    writeFileSync(victim, "keep\n");
    for (const env of [{}, { BUT_AXI_NO_GRIT: "1" }]) {
      const r = axi(["log", "--", `--output=${victim}`], { env });
      expect(r.code).toBe(2);
      expect(r.out).toContain("code: INVALID_VALUE");
      expect(axi(["blame", "f", "--rev", "--output=x"], { env }).code).toBe(2);
    }
    expect(readFileSync(victim, "utf8")).toBe("keep\n");
  });

  it("never runs grit mutations: a fake grit only sees read-only verbs", () => {
    const dir = repo();
    const seen = join(dir, "seen.txt");
    const fake = fakeBut(`echo "$1" >> ${seen}; echo '{"commits":[]}'`);
    axi(["log"], { cwd: dir, env: { BUT_AXI_GRIT: fake } });
    axi(["blame", "f.txt"], { cwd: dir, env: { BUT_AXI_GRIT: fake } });
    expect(readFileSync(seen, "utf8").trim().split("\n")).toEqual(["log", "blame"]);
  });
});
