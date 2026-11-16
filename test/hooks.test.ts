import { mkdtempSync, mkdirSync, readdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { hookCommand, hookCwd, installHooks, isManaged, MARKER, removeFlatHook, removeGroupHook, runtimePaths, upsertFlatHook, upsertGroupHook } from "../src/hooks.js";

const CMD = `'/n' '/x/but-axi.js' hook session-start --agent claude # ${MARKER}`;

describe("group hooks (Claude Code / Codex)", () => {
  const existing = { model: "x", hooks: { SessionStart: [{ matcher: "", hooks: [{ type: "command", command: "gh-axi", timeout: 10 }] }], Stop: [{ hooks: [{ type: "command", command: "y" }] }] } };
  it("merges without clobbering and is idempotent", () => {
    const [a, c1] = upsertGroupHook(existing, CMD, 10);
    expect(c1).toBe(true);
    expect(a.model).toBe("x");
    expect(a.hooks.Stop).toEqual(existing.hooks.Stop);
    expect(a.hooks.SessionStart).toHaveLength(2);
    expect(a.hooks.SessionStart[0].hooks[0].command).toBe("gh-axi");
    const [b, c2] = upsertGroupHook(a, CMD, 10);
    expect(c2).toBe(false);
    expect(b).toEqual(a);
  });
  it("repairs a stale managed command in place", () => {
    const [a] = upsertGroupHook(existing, CMD, 10);
    const [b, changed] = upsertGroupHook(a, CMD.replace("/n", "/n2"), 10);
    expect(changed).toBe(true);
    expect(b.hooks.SessionStart).toHaveLength(2);
    expect(b.hooks.SessionStart[1].hooks[0].command).toContain("/n2");
  });
  it("uninstall removes only the managed entry", () => {
    const [a] = upsertGroupHook(existing, CMD, 10);
    const [b, changed] = removeGroupHook(a);
    expect(changed).toBe(true);
    expect(b).toEqual(existing);
    expect(removeGroupHook(b)[1]).toBe(false);
  });
});

describe("flat hooks (Cursor)", () => {
  it("merges, dedupes, removes", () => {
    const cur = { version: 1, hooks: { sessionStart: [{ command: "other" }], stop: [{ command: "s" }] } };
    const [a, c] = upsertFlatHook(cur, CMD, 10);
    expect(c).toBe(true);
    expect(a.hooks.sessionStart.map((h: { command: string }) => h.command)).toEqual(["other", CMD]);
    expect(upsertFlatHook(a, CMD, 10)[1]).toBe(false);
    const [b] = removeFlatHook(a);
    expect(b).toEqual(cur);
  });
});

describe("installHooks on a temp home", () => {
  it("backs up, installs idempotently, uninstalls", () => {
    const home = mkdtempSync(join(tmpdir(), "but-axi-home-"));
    mkdirSync(join(home, ".claude"));
    mkdirSync(join(home, ".codex"));
    writeFileSync(join(home, ".claude", "settings.json"), JSON.stringify({ theme: "dark" }));
    const r1 = installHooks({ home });
    expect(r1.find((r) => r.agent === "claude")!.action).toBe("installed");
    expect(r1.find((r) => r.agent === "codex")!.backup).toBe("(new file)");
    expect(r1.find((r) => r.agent === "cursor")!.action).toMatch(/skipped/);
    const settings = JSON.parse(readFileSync(join(home, ".claude", "settings.json"), "utf8"));
    expect(settings.theme).toBe("dark");
    expect(settings.hooks.SessionStart[0].hooks[0].command).toContain(MARKER);
    expect(readdirSync(join(home, ".claude")).some((f) => f.startsWith("settings.json.bak-but-axi-"))).toBe(true);
    const r2 = installHooks({ home });
    expect(r2.filter((r) => r.action.includes("no change"))).toHaveLength(2);
    const r3 = installHooks({ home, uninstall: true });
    expect(r3.filter((r) => r.action === "removed")).toHaveLength(2);
    const after = JSON.parse(readFileSync(join(home, ".claude", "settings.json"), "utf8"));
    expect(after.hooks.SessionStart).toEqual([]);
    expect(after.theme).toBe("dark");
  });
});

describe("portable hook command (AXI §7)", () => {
  const setup = () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "but-axi-bin-")));
    const script = join(root, "pkg", "but-axi.js");
    mkdirSync(join(root, "pkg"));
    writeFileSync(script, "", { mode: 0o755 });
    const node = join(root, "Cellar", "node-26", "node");
    mkdirSync(join(root, "Cellar", "node-26"), { recursive: true });
    writeFileSync(node, "");
    const bin = join(root, "bin");
    mkdirSync(bin);
    return { root, script, node, bin };
  };
  it("uses the PATH name when it resolves to this script", () => {
    const { script, node, bin } = setup();
    symlinkSync(script, join(bin, "but-axi"));
    expect(hookCommand("claude", node, script, `/nope:${bin}`)).toBe(`but-axi hook session-start --agent claude # ${MARKER}`);
  });
  it("falls back to absolute paths when PATH has another or no but-axi", () => {
    const { root, script, node, bin } = setup();
    writeFileSync(join(root, "other.js"), "");
    symlinkSync(join(root, "other.js"), join(bin, "but-axi"));
    const cmd = hookCommand("codex", node, script, bin);
    expect(cmd).toBe(`${node} ${script} hook session-start --agent codex # ${MARKER}`);
    expect(cmd).not.toContain("/opt/homebrew");
  });
  it("uses absolute paths when an earlier PATH dir has a different executable but-axi", () => {
    const { root, script, node, bin } = setup();
    const early = join(root, "early");
    mkdirSync(early);
    writeFileSync(join(early, "but-axi"), "#!/bin/sh\n", { mode: 0o755 });
    symlinkSync(script, join(bin, "but-axi"));
    expect(hookCommand("claude", node, script, `${early}:${bin}`)).toBe(`${node} ${script} hook session-start --agent claude # ${MARKER}`);
  });
  it("prefers a node on PATH that resolves to the running node", () => {
    const { script, node, bin } = setup();
    symlinkSync(node, join(bin, "node"));
    expect(runtimePaths(node, script, bin)).toEqual({ node: join(bin, "node"), js: script });
    expect(runtimePaths(node, script, "").node).toBe(node);
  });
  it("quotes paths with spaces", () => {
    const { root, script } = setup();
    const spaced = join(root, "my node");
    writeFileSync(spaced, "");
    expect(hookCommand("cursor", spaced, script, "")).toContain(`'${spaced}'`);
  });
});

describe("hook helpers", () => {
  it("isManaged", () => {
    expect(isManaged(CMD)).toBe(true);
    expect(isManaged("gh-axi")).toBe(false);
  });
  it("hookCwd prefers stdin cwd, then cursor roots, then env", () => {
    expect(hookCwd({ cwd: "/a" }, {}, "/z")).toBe("/a");
    expect(hookCwd({ workspace_roots: ["/b"] }, {}, "/z")).toBe("/b");
    expect(hookCwd(undefined, { CLAUDE_PROJECT_DIR: "/c" }, "/z")).toBe("/c");
    expect(hookCwd(undefined, {}, "/z")).toBe("/z");
  });
});
