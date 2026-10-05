import { mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { hookCwd, installHooks, isManaged, MARKER, removeFlatHook, removeGroupHook, upsertFlatHook, upsertGroupHook } from "../src/hooks.js";

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
