import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { hookStatus, installHooks } from "../src/hooks.js";
import { OMP_MARKER, ompOps, ompPaths, renderOmpExtension, templatePath } from "../src/omp.js";

const tmp = (p: string) => mkdtempSync(join(tmpdir(), p));

describe("omp extension template", () => {
  it("renders absolute paths and keeps the marker", () => {
    const src = renderOmpExtension("/opt/n's/node", "/x/but-axi.js");
    expect(src).toContain(OMP_MARKER);
    expect(src).toContain("# but-axi hook session-start");
    expect(src).toContain(`const NODE: string = ${JSON.stringify("/opt/n's/node")};`);
    expect(src).toContain(`const SCRIPT: string = "/x/but-axi.js";`);
    expect(src).not.toMatch(/__BUT_AXI_(NODE|SCRIPT)__/);
    expect(templatePath()).toMatch(/omp\/but-axi\.ts$/);
  });

  // Load the rendered extension against a fake omp API and a fake but-axi script.
  async function load(scriptBody: string) {
    const dir = tmp("baxi-omp-ext-");
    const script = join(dir, "fake.mjs");
    writeFileSync(script, scriptBody);
    const file = join(dir, "ext.ts");
    writeFileSync(file, renderOmpExtension(process.execPath, script));
    const mod = await import(pathToFileURL(file).href);
    const handlers: Record<string, (e: any, c: any) => any> = {};
    const commands: Record<string, any> = {};
    mod.default({ on: (n: string, h: any) => (handlers[n] = h), registerCommand: (n: string, s: any) => (commands[n] = s) });
    return { mod, handlers, commands, dir };
  }
  const echoCwd = `let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const {cwd}=JSON.parse(s);if(cwd.endsWith("ws"))process.stdout.write("count: 1 stack\\n"+process.argv.slice(2).join(" "));});`;

  it("injects the dashboard at session start inside a workspace", async () => {
    const { handlers, commands, dir } = await load(echoCwd);
    const ws = join(dir, "ws");
    mkdirSync(ws);
    handlers.session_start({}, { cwd: ws });
    const r = await handlers.before_agent_start({ systemPrompt: ["base"] }, { cwd: ws });
    expect(r.systemPrompt[0]).toBe("base");
    expect(r.systemPrompt[1]).toContain("GitButler workspace");
    expect(r.systemPrompt[1]).toContain("hook session-start --agent omp");
    const s = await handlers.before_agent_start({ systemPrompt: "base" }, { cwd: ws });
    expect(s.systemPrompt).toMatch(/^base\n\nGitButler workspace/);
    const notes: string[] = [];
    await commands["but-axi"].handler("", { cwd: ws, ui: { notify: (m: string) => notes.push(m) } });
    expect(notes[0]).toContain("count: 1 stack");
  });

  it("stays quiet outside a workspace and on errors", async () => {
    const { handlers, dir } = await load(echoCwd);
    handlers.session_start({}, { cwd: dir });
    expect(await handlers.before_agent_start({ systemPrompt: ["base"] }, { cwd: dir })).toBeUndefined();
    const bad = await load(`process.stdout.write("x");process.exit(1);`);
    bad.handlers.session_start({}, { cwd: bad.dir });
    expect(await bad.handlers.before_agent_start({ systemPrompt: ["base"] }, {})).toBeUndefined();
  });

  it("times out safely", async () => {
    const { mod, dir } = await load(`process.stdout.write("late");setTimeout(()=>{},60000);`);
    const t0 = Date.now();
    expect(await mod.runDashboard(dir, 300)).toBe("");
    expect(Date.now() - t0).toBeLessThan(3000);
  });
});

describe("omp install/uninstall", () => {
  const opts = (home: string, extra = {}) => ({ home, node: "/n", script: "/x/but-axi.js", ...extra });

  it("installs, is idempotent, repairs with backup, uninstalls with backup", () => {
    const home = tmp("baxi-omp-home-");
    const { file } = ompPaths(home);
    expect(ompOps(opts(home, { dryRun: true })).action).toBe("would install");
    expect(existsSync(file)).toBe(false);
    const a = ompOps(opts(home));
    expect(a).toMatchObject({ action: "installed", backup: "(new file)" });
    expect(readFileSync(file, "utf8")).toContain('"/x/but-axi.js"');
    expect(ompOps(opts(home)).action).toBe("already installed (no change)");
    const b = ompOps(opts(home, { script: "/y/but-axi.js" }));
    expect(b.action).toBe("updated");
    expect(b.backup).toContain("but-axi.ts.bak-but-axi-");
    // Backups live outside the auto-discovered extensions dir.
    expect(readdirSync(join(home, ".omp", "agent", "extensions"))).toEqual(["but-axi.ts"]);
    expect(ompOps(opts(home, { uninstall: true, dryRun: true })).action).toBe("would remove");
    expect(existsSync(file)).toBe(true);
    const c = ompOps(opts(home, { uninstall: true }));
    expect(c.action).toBe("removed");
    expect(existsSync(file)).toBe(false);
    expect(readdirSync(join(home, ".omp", "agent")).filter((f) => f.startsWith("but-axi.ts.bak"))).toHaveLength(2);
    expect(ompOps(opts(home, { uninstall: true })).action).toBe("not installed (no change)");
  });

  it("refuses to touch a foreign but-axi.ts", () => {
    const home = tmp("baxi-omp-home-");
    const { dir, file } = ompPaths(home);
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, "export default () => {}\n");
    expect(() => ompOps(opts(home))).toThrow(/not managed by but-axi/);
    expect(() => ompOps(opts(home, { uninstall: true }))).toThrow(/not managed by but-axi/);
    expect(readFileSync(file, "utf8")).toBe("export default () => {}\n");
  });

  it("is wired into installHooks and hookStatus", () => {
    const home = tmp("baxi-omp-home-");
    expect(installHooks({ home }).find((r) => r.agent === "omp")?.action).toBe("skipped (not installed)");
    mkdirSync(join(home, ".omp"));
    expect(hookStatus(home).find((r) => r.agent === "omp")?.installed).toBe(false);
    expect(installHooks({ home, agents: ["omp"] })).toMatchObject([{ agent: "omp", action: "installed" }]);
    expect(hookStatus(home).find((r) => r.agent === "omp")?.installed).toBe(true);
    expect(installHooks({ home, agents: ["omp"], uninstall: true })[0].action).toBe("removed");
  });
});
