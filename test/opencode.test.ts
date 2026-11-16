import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { hookStatus, installHooks } from "../src/hooks.js";
import { OPENCODE_MARKER, opencodeOps, opencodePaths, renderOpencodePlugin } from "../src/opencode.js";

const tmp = (p: string) => mkdtempSync(join(tmpdir(), p));
const echoCwd = `let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const {cwd}=JSON.parse(s);if(cwd.endsWith("ws"))process.stdout.write("count: 1 stack\\n"+process.argv.slice(2).join(" "));});`;

async function load(scriptBody: string) {
  const dir = tmp("baxi-oc-ext-");
  const script = join(dir, "fake.mjs");
  writeFileSync(script, scriptBody);
  const file = join(dir, "plugin.mjs");
  writeFileSync(file, renderOpencodePlugin([process.execPath, script]));
  const mod = await import(pathToFileURL(file).href);
  return { mod, dir };
}

describe("opencode plugin", () => {
  it("keeps the marker and the hook args", () => {
    const src = renderOpencodePlugin(["but-axi"]);
    expect(src).toContain(OPENCODE_MARKER);
    expect(src).toContain('const COMMAND = "but-axi";');
    expect(src).toContain('["hook","session-start","--agent","opencode"]');
  });

  it("OpenCode 2: pushes the dashboard into session context once per session", async () => {
    const { mod, dir } = await load(echoCwd);
    const ws = join(dir, "ws");
    mkdirSync(ws);
    let hook: (e: any) => Promise<void> = async () => {};
    await mod.default.setup({ location: { directory: ws }, session: { hook: (_n: string, h: any) => (hook = h) } });
    const event = { sessionID: "s1", system: [] as any[] };
    await hook(event);
    expect(event.system).toHaveLength(1);
    expect(event.system[0].text).toContain("count: 1 stack");
    expect(event.system[0].text).toContain("hook session-start --agent opencode");
  });

  it("OpenCode 1: transforms the system prompt; quiet outside a workspace", async () => {
    const { mod, dir } = await load(echoCwd);
    const ws = join(dir, "ws");
    mkdirSync(ws);
    const inWs = await mod.default.server({ directory: ws });
    const out = { system: [] as string[] };
    await inWs["experimental.chat.system.transform"]({ sessionID: "a" }, out);
    expect(out.system[0]).toMatch(/^GitButler workspace/);
    const outside = await mod.default.server({ directory: dir });
    const none = { system: [] as string[] };
    await outside["experimental.chat.system.transform"]({ sessionID: "a" }, none);
    expect(none.system).toEqual([]);
  });
});

describe("opencode install/uninstall", () => {
  it("installs, is idempotent, repairs, uninstalls, keeps backups out of plugins/", () => {
    const home = tmp("baxi-oc-home-");
    const { dir, file } = opencodePaths(home);
    expect(opencodeOps({ home, argv: ["but-axi"], dryRun: true }).action).toBe("would install");
    expect(existsSync(file)).toBe(false);
    expect(opencodeOps({ home, argv: ["but-axi"] })).toMatchObject({ action: "installed", backup: "(new file)" });
    expect(opencodeOps({ home, argv: ["but-axi"] }).action).toBe("already installed (no change)");
    expect(opencodeOps({ home, argv: ["/n", "/x.js"] }).action).toBe("updated");
    expect(readdirSync(dir)).toEqual(["but-axi.js"]);
    expect(opencodeOps({ home, argv: [], uninstall: true }).action).toBe("removed");
    expect(existsSync(file)).toBe(false);
  });

  it("refuses a foreign plugin file", () => {
    const home = tmp("baxi-oc-home-");
    const { dir, file } = opencodePaths(home);
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, "export default {}\n");
    expect(() => opencodeOps({ home, argv: ["but-axi"] })).toThrow(/not managed by but-axi/);
    expect(readFileSync(file, "utf8")).toBe("export default {}\n");
  });

  it("is wired into installHooks and hookStatus", () => {
    const home = tmp("baxi-oc-home-");
    expect(installHooks({ home }).find((r) => r.agent === "opencode")?.action).toBe("skipped (not installed)");
    mkdirSync(join(home, ".config", "opencode"), { recursive: true });
    expect(hookStatus(home).find((r) => r.agent === "opencode")?.installed).toBe(false);
    expect(installHooks({ home, agents: ["opencode"] })).toMatchObject([{ agent: "opencode", action: "installed" }]);
    expect(hookStatus(home).find((r) => r.agent === "opencode")?.installed).toBe(true);
    expect(installHooks({ home, agents: ["opencode"], uninstall: true })[0]!.action).toBe("removed");
  });
});
