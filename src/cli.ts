import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { bool, parseArgs, str, type FlagSpec } from "./args.js";
import {
  branchList,
  branchNew,
  commit,
  diffView,
  homeView,
  makeCtx,
  oplogList,
  oplogRestore,
  oplogSnapshot,
  push,
  run,
  showView,
  statusView,
  undoRedo,
} from "./commands.js";
import { AxiError, UsageError } from "./errors.js";
import { plural, render, renderError, tildify, type Output } from "./format.js";
import { COMMAND_HELP, TOP_HELP } from "./help.js";
import { hookCwd, hookStatus, installHooks, parseAgents, readHookInput } from "./hooks.js";

const RAW_BUT = new Set([
  "amend", "absorb", "squash", "move", "reword", "uncommit", "discard", "resolve", "apply", "unapply",
  "pull", "pr", "land", "pick", "worktree", "teardown", "clean", "open", "gui", "tui", "config", "alias", "skill", "agent", "update", "completions",
]);

export function version(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    for (const p of [join(here, "..", "package.json"), join(here, "..", "..", "package.json")]) {
      try {
        return JSON.parse(readFileSync(p, "utf8")).version as string;
      } catch {
        /* try next */
      }
    }
  } catch {
    /* ignore */
  }
  return "0.0.0";
}

const SPECS: Record<string, FlagSpec> = {
  home: {},
  status: {},
  diff: {},
  show: {},
  commit: { message: { type: "strings", short: "m" }, branch: { type: "string", short: "b" } },
  branch: { above: { type: "string", short: "A" }, below: { type: "string", short: "B" } },
  push: { "dry-run": { type: "boolean", short: "d" }, "with-force": { type: "boolean", short: "f" }, "no-verify": { type: "boolean" } },
  undo: {},
  redo: {},
  oplog: { limit: { type: "string", short: "n" }, message: { type: "string", short: "m" } },
  setup: { uninstall: { type: "boolean" }, status: { type: "boolean" }, agents: { type: "string" }, "dry-run": { type: "boolean" } },
  hook: { agent: { type: "string" } },
  version: { version: { type: "boolean", short: "v" } },
};

/** Split argv into [command, rest], allowing global flags (e.g. -C <dir>) before the command. */
export function splitCommand(argv: string[]): { command: string | undefined; rest: string[] } {
  const rest: string[] = [];
  let command: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (command === undefined) {
      if (a === "-C" || a === "--cwd" || a === "--fields" || a === "--query" || a === "-q") {
        rest.push(a);
        if (argv[i + 1] !== undefined) rest.push(argv[++i]!);
        continue;
      }
      if (a.startsWith("-")) {
        rest.push(a);
        continue;
      }
      command = a;
      continue;
    }
    rest.push(a);
  }
  return { command, rest };
}

export interface RunResult {
  stdout: string;
  exitCode: number;
}

export async function main(argv: string[], bin = process.argv[1] ?? "but-axi"): Promise<RunResult> {
  try {
    if (argv.length === 1 && (argv[0] === "--version" || argv[0] === "-v")) return { stdout: `${version()}\n`, exitCode: 0 };
    const { command, rest } = splitCommand(argv);
    if (command === undefined) {
      if (rest.includes("--help") || rest.includes("-h")) return { stdout: TOP_HELP, exitCode: 0 };
      const ctx = makeCtx(rest, SPECS.home!, "");
      return ok(homeView(ctx, resolve(bin)));
    }
    if (!(command in SPECS) || command === "home") {
      const help = [`Run \`but-axi --help\` to list commands`];
      if (RAW_BUT.has(command)) help.unshift(`\`${command}\` is not wrapped — run raw \`but ${command} --help\``);
      throw new UsageError(`unknown command ${command}`, help, "UNKNOWN_COMMAND");
    }
    if (rest.includes("--help") || rest.includes("-h")) {
      parseArgs(rest, SPECS[command]!, command); // still fail loud on unknown flags
      return { stdout: COMMAND_HELP[command] ?? TOP_HELP, exitCode: 0 };
    }
    const ctx = makeCtx(rest, SPECS[command]!, command);
    const pos = ctx.p.positionals;
    switch (command) {
      case "status":
        if (pos.length) throw new UsageError(`unexpected argument ${pos[0]}`, ["Run `but-axi status --help`"]);
        return ok(statusView(ctx));
      case "diff":
        return ok(diffView(ctx));
      case "show":
        return ok(showView(ctx));
      case "commit":
        return ok(commit(ctx));
      case "branch": {
        const sub = pos[0];
        if (sub === undefined || sub === "list") {
          if (pos.length > 1) throw new UsageError(`unexpected argument ${pos[1]}`, ["Run `but-axi branch --help`"]);
          return ok(branchList(ctx));
        }
        if (sub === "new") {
          ctx.p.positionals = pos.slice(1);
          return ok(branchNew(ctx));
        }
        if (sub === "show") {
          if (pos.length !== 2) throw new AxiError("branch show needs exactly one <name>", "MISSING_ARGUMENT", [run(ctx, "branch show <name>")]);
          ctx.p.positionals = pos.slice(1);
          return ok(showView(ctx));
        }
        throw new UsageError(`unknown branch subcommand ${sub}`, ["Run `but-axi branch --help`", "Other branch operations: raw `but branch --help`"], "UNKNOWN_COMMAND");
      }
      case "push":
        return ok(push(ctx));
      case "undo":
      case "redo":
        return ok(undoRedo(ctx, command));
      case "oplog": {
        const sub = pos[0];
        ctx.p.positionals = pos.slice(1);
        if (sub === undefined || sub === "list") return ok(oplogList(ctx));
        if (sub === "snapshot") return ok(oplogSnapshot(ctx));
        if (sub === "restore") return ok(oplogRestore(ctx));
        throw new UsageError(`unknown oplog subcommand ${sub}`, ["Run `but-axi oplog --help`"], "UNKNOWN_COMMAND");
      }
      case "setup":
        return setup(ctx.p.positionals, bool(ctx.p, "uninstall"), bool(ctx.p, "status"), str(ctx.p, "agents"), bool(ctx.p, "dry-run"));
      case "hook":
        return await hook(pos, str(ctx.p, "agent"), resolve(bin));
      case "version":
        return { stdout: `${version()}\n`, exitCode: 0 };
    }
    throw new UsageError(`unknown command ${command}`, ["Run `but-axi --help`"], "UNKNOWN_COMMAND");
  } catch (e) {
    if (e instanceof AxiError) return { stdout: renderError(e), exitCode: e.exitCode };
    const msg = e instanceof Error ? e.message : String(e);
    process.stderr.write(`[but-axi] internal error: ${e instanceof Error ? e.stack : msg}\n`);
    return { stdout: renderError(new AxiError(`internal error: ${msg}`, "INTERNAL", ["Rerun with BUT_AXI_DEBUG=1 for details"])), exitCode: 1 };
  }
}

function ok(out: Output): RunResult {
  return { stdout: render(out), exitCode: 0 };
}

function setup(pos: string[], uninstall: boolean, status: boolean, agentsFlag: string | undefined, dryRun: boolean): RunResult {
  if (pos[0] !== "hooks" || pos.length > 1) {
    throw new UsageError(pos[0] ? `unknown setup target ${pos[0]}` : "setup needs a target", ["Run `but-axi setup hooks`", "Run `but-axi setup --help`"], "UNKNOWN_COMMAND");
  }
  if (status) {
    const rows = hookStatus();
    const n = rows.filter((r) => r.installed).length;
    return ok({
      data: { count: `${n} of ${plural(rows.length, "agent")} have the but-axi SessionStart hook`, hooks: rows },
      help: n < rows.length ? ["Run `but-axi setup hooks`"] : ["Run `but-axi setup hooks --uninstall` to remove"],
    });
  }
  const agents = parseAgents(agentsFlag);
  const rows = installHooks({ agents, uninstall, dryRun });
  const changed = rows.filter((r) => /^(installed|removed|would )/.test(r.action)).length;
  const help = uninstall
    ? ["Run `but-axi setup hooks` to reinstall"]
    : ["Start a new agent session inside a GitButler repo to see the dashboard", "Run `but-axi setup hooks --status`", "Run `but-axi setup hooks --uninstall` to remove"];
  if (!uninstall && rows.some((r) => r.agent === "codex" && r.action === "installed")) help.push("Codex may ask you to trust the new hook on its next start");
  return ok({
    data: {
      setup: uninstall ? "hooks uninstall" : "hooks install",
      count: `${changed} ${dryRun ? "would change" : "changed"}; ${rows.length - changed} unchanged`,
      hooks: rows,
      not_supported: "jcode (single session_start slot already in use); omp (TypeScript extensions only)",
    },
    help,
  });
}

async function hook(pos: string[], agent: string | undefined, bin: string): Promise<RunResult> {
  if (pos[0] !== "session-start" || pos.length > 1) {
    throw new UsageError(`unknown hook ${pos[0] ?? "(none)"}`, ["Run `but-axi hook session-start`"], "UNKNOWN_COMMAND");
  }
  const empty = { stdout: agent === "cursor" ? "{}\n" : "", exitCode: 0 };
  try {
    const input = await readHookInput();
    const cwd = hookCwd(input);
    const ctx = makeCtx([], SPECS.home!, "");
    ctx.cwd = cwd;
    const out = homeView(ctx, bin);
    if (!("count" in out.data)) return empty; // not a GitButler workspace: stay quiet
    const text = render(out);
    if (agent === "cursor") return { stdout: JSON.stringify({ additional_context: text }) + "\n", exitCode: 0 };
    return { stdout: text, exitCode: 0 };
  } catch {
    return empty;
  }
}

export { tildify };
