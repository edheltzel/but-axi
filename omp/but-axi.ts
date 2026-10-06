// but-axi-omp-extension v1 — managed by `but-axi setup hooks` (marker: # but-axi hook session-start)
// Injects the but-axi home view (GitButler workspace dashboard) into omp sessions.
// Self-contained: no @oh-my-pi runtime import. Quiet outside GitButler workspaces.
// Remove with `but-axi setup hooks --uninstall --agents omp`.

import { spawn } from "node:child_process";

const NODE: string = __BUT_AXI_NODE__;
const SCRIPT: string = __BUT_AXI_SCRIPT__;
const TIMEOUT_MS = 5_000;
const MAX_BYTES = 64 * 1024;

interface Ctx {
  cwd?: string;
  hasUI?: boolean;
  ui?: { notify?: (message: string, type?: "info" | "warning" | "error") => void };
}

interface Api {
  on(event: string, handler: (event: any, ctx: Ctx) => unknown): void;
  registerCommand?(name: string, spec: { description: string; handler: (args: string, ctx: Ctx) => unknown }): void;
}

/** Run `but-axi hook session-start --agent omp`; resolves "" on any error, non-zero exit, or timeout. */
export function runDashboard(cwd: string, timeoutMs = TIMEOUT_MS): Promise<string> {
  return new Promise((resolve) => {
    let out = "";
    let done = false;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const finish = (value: string) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      clearTimeout(killTimer);
      resolve(value);
    };
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(NODE, [SCRIPT, "hook", "session-start", "--agent", "omp"], {
        cwd,
        stdio: ["pipe", "pipe", "ignore"],
        env: { ...process.env, NO_COLOR: "1" },
      });
    } catch {
      resolve("");
      return;
    }
    const timer = setTimeout(() => {
      try {
        child.kill("SIGTERM");
      } catch {}
      killTimer = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {}
      }, 500);
      finish("");
    }, timeoutMs);
    child.stdout?.on("data", (chunk: Buffer) => {
      if (out.length < MAX_BYTES) out += chunk.toString("utf8");
    });
    child.once("error", () => finish(""));
    child.once("close", (code: number | null) => finish(code === 0 ? out.slice(0, MAX_BYTES).trim() : ""));
    child.stdin?.on("error", () => {});
    child.stdin?.end(JSON.stringify({ cwd }), "utf8");
  });
}

export function appendToSystemPrompt(systemPrompt: unknown, block: string): string[] | string {
  if (Array.isArray(systemPrompt)) return [...systemPrompt, block];
  const base = typeof systemPrompt === "string" ? systemPrompt : "";
  return base ? `${base}\n\n${block}` : block;
}

export default function butAxiOmpExtension(pi: Api): void {
  let dashboard = "";
  let pending: Promise<string> | undefined;

  const refresh = (ctx: Ctx) => {
    const cwd = ctx?.cwd || process.cwd();
    pending = runDashboard(cwd).then((text) => {
      dashboard = text;
      return text;
    });
    return pending;
  };

  pi.on("session_start", (_event, ctx) => {
    void refresh(ctx);
  });
  try {
    pi.on("session_switch", (_event, ctx) => {
      void refresh(ctx);
    });
  } catch {}

  pi.on("before_agent_start", async (event) => {
    if (pending) await pending; // bounded by TIMEOUT_MS
    if (!dashboard) return;
    const block = `GitButler workspace (but-axi dashboard at session start; run \`but-axi\` for live state):\n${dashboard}`;
    return { systemPrompt: appendToSystemPrompt(event?.systemPrompt, block) };
  });

  try {
    pi.registerCommand?.("but-axi", {
      description: "Show the but-axi GitButler dashboard for this directory",
      handler: async (_args, ctx) => {
        const text = await refresh(ctx);
        try {
          ctx.ui?.notify?.(text || "but-axi: not a GitButler workspace", "info");
        } catch {}
      },
    });
  } catch {}
}
