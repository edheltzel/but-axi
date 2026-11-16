import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { AxiError } from "./errors.js";
import { tildify } from "./format.js";

/** Text every managed OpenCode plugin carries; used to recognize our file. */
export const OPENCODE_MARKER = "but-axi managed opencode plugin";

export function opencodePaths(home = homedir()): { root: string; dir: string; file: string } {
  const root = join(home, ".config", "opencode");
  const dir = join(root, "plugins");
  return { root, dir, file: join(dir, "but-axi.js") };
}

/**
 * One default export both OpenCode generations load: OpenCode 2 validates `id` and runs `setup(ctx)`,
 * OpenCode 1 runs `server(input)` (same shape as axi-sdk-js's managed plugin).
 */
export function renderOpencodePlugin(argv: string[], timeoutMs = 5_000): string {
  const [cmd, ...pre] = argv;
  return `// ${OPENCODE_MARKER} (marker: # but-axi hook session-start)
// Injects the but-axi home view (GitButler workspace dashboard) into OpenCode sessions.
// Remove with \`but-axi setup hooks --uninstall --agents opencode\`.
import { spawn } from "node:child_process";

const COMMAND = ${JSON.stringify(cmd)};
const ARGS = ${JSON.stringify([...pre, "hook", "session-start", "--agent", "opencode"])};
const TIMEOUT_MS = ${timeoutMs};
const MAX_BYTES = 64 * 1024;

export function runDashboard(cwd, timeoutMs = TIMEOUT_MS) {
  return new Promise((resolve) => {
    let out = "";
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(v);
    };
    let child;
    try {
      child = spawn(COMMAND, ARGS, { cwd, stdio: ["pipe", "pipe", "ignore"], env: { ...process.env, NO_COLOR: "1" } });
    } catch {
      resolve("");
      return;
    }
    const timer = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch {}
      finish("");
    }, timeoutMs);
    child.stdout?.on("data", (c) => { if (out.length < MAX_BYTES) out += c.toString("utf8"); });
    child.once("error", () => finish(""));
    child.once("close", (code) => finish(code === 0 ? out.slice(0, MAX_BYTES).trim() : ""));
    child.stdin?.on("error", () => {});
    child.stdin?.end(JSON.stringify({ cwd }), "utf8");
  });
}

function contextFor(directory) {
  const cache = new Map();
  return async (sessionID) => {
    const key = sessionID ?? "__global__";
    if (!cache.has(key)) cache.set(key, await runDashboard(typeof directory === "string" && directory ? directory : process.cwd()));
    const text = cache.get(key);
    return text ? "GitButler workspace (but-axi dashboard at session start; run \`but-axi\` for live state):\\n" + text : "";
  };
}

export default {
  id: "but-axi",
  async setup(ctx) {
    const context = contextFor(ctx?.location?.directory);
    await ctx.session.hook("context", async (event) => {
      const text = await context(event.sessionID);
      if (text) event.system.push({ type: "text", text });
    });
  },
  async server({ directory }) {
    const context = contextFor(directory);
    return {
      "experimental.chat.system.transform": async (input, output) => {
        const text = await context(input.sessionID);
        if (text) output.system.push(text);
      },
    };
  },
};
`;
}

export interface OpencodeResult {
  action: string;
  file: string;
  backup: string;
}

export function opencodeInstalled(home = homedir()): boolean {
  const { file } = opencodePaths(home);
  return existsSync(file) && readFileSync(file, "utf8").includes(OPENCODE_MARKER);
}

/** Backups go next to (not inside) the auto-loaded plugins dir so OpenCode never loads them. */
function backupPath(root: string): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  const base = join(root, `but-axi.js.bak-but-axi-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`);
  let out = base;
  for (let i = 1; existsSync(out); i++) out = `${base}-${i}`;
  return out;
}

export function opencodeOps(opts: { home?: string; uninstall?: boolean; dryRun?: boolean; argv: string[] }): OpencodeResult {
  const { root, dir, file } = opencodePaths(opts.home);
  const shown = tildify(file);
  const exists = existsSync(file);
  const current = exists ? readFileSync(file, "utf8") : "";
  if (exists && !current.includes(OPENCODE_MARKER)) {
    throw new AxiError(`refusing to touch ${shown}: it exists and is not managed by but-axi`, "FOREIGN_FILE", ["Move or rename that file, then rerun `but-axi setup hooks --agents opencode`"]);
  }
  if (opts.uninstall) {
    if (!exists) return { action: "not installed (no change)", file: shown, backup: "" };
    if (opts.dryRun) return { action: "would remove", file: shown, backup: "" };
    const bak = backupPath(root);
    copyFileSync(file, bak);
    rmSync(file);
    return { action: "removed", file: shown, backup: tildify(bak) };
  }
  const next = renderOpencodePlugin(opts.argv);
  if (exists && current === next) return { action: "already installed (no change)", file: shown, backup: "" };
  if (opts.dryRun) return { action: exists ? "would update" : "would install", file: shown, backup: "" };
  let backup = "(new file)";
  if (exists) {
    const bak = backupPath(root);
    copyFileSync(file, bak);
    backup = tildify(bak);
  }
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, next);
  return { action: exists ? "updated" : "installed", file: shown, backup };
}
