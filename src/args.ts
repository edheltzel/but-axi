import { UsageError } from "./errors.js";

export type FlagType = "boolean" | "string" | "strings";

export interface FlagDef {
  type: FlagType;
  short?: string;
  /** Extra long aliases, without the leading dashes. */
  aliases?: string[];
}

export type FlagSpec = Record<string, FlagDef>;

export interface Parsed {
  flags: Record<string, boolean | string | string[] | undefined>;
  positionals: string[];
}

/** Flags every command accepts. */
export const GLOBAL_FLAGS: FlagSpec = {
  help: { type: "boolean", short: "h" },
  full: { type: "boolean" },
  fields: { type: "string" },
  query: { type: "string", short: "q" },
  cwd: { type: "string", short: "C" },
};

/**
 * Strict argv parser: unknown flags and missing values throw UsageError (exit 2).
 * Supports `--flag value`, `--flag=value`, `-f value`, `-fvalue` is NOT supported, `--` ends flags.
 */
export function parseArgs(argv: string[], spec: FlagSpec, cmd: string): Parsed {
  const all: FlagSpec = { ...GLOBAL_FLAGS, ...spec };
  const byLong = new Map<string, string>();
  const byShort = new Map<string, string>();
  for (const [name, def] of Object.entries(all)) {
    byLong.set(name, name);
    for (const a of def.aliases ?? []) byLong.set(a, name);
    if (def.short) byShort.set(def.short, name);
  }
  const flags: Parsed["flags"] = {};
  const positionals: string[] = [];
  const helpHint = `Run \`but-axi ${cmd ? cmd + " " : ""}--help\` to see supported flags`;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--") {
      positionals.push(...argv.slice(i + 1));
      break;
    }
    let name: string | undefined;
    let inline: string | undefined;
    let display = arg;
    if (arg.startsWith("--")) {
      const eq = arg.indexOf("=");
      const key = eq >= 0 ? arg.slice(2, eq) : arg.slice(2);
      if (eq >= 0) inline = arg.slice(eq + 1);
      display = `--${key}`;
      name = byLong.get(key);
    } else if (arg.startsWith("-") && arg.length > 1 && !/^-\d/.test(arg)) {
      const key = arg.slice(1);
      name = key.length === 1 ? byShort.get(key) : undefined;
    } else {
      positionals.push(arg);
      continue;
    }
    if (!name) throw new UsageError(`unknown flag ${display}`, [helpHint], "UNKNOWN_FLAG");
    const def = all[name]!;
    if (def.type === "boolean") {
      if (inline !== undefined) throw new UsageError(`flag ${display} does not take a value`, [helpHint]);
      flags[name] = true;
      continue;
    }
    let value = inline;
    if (value === undefined) {
      const next = argv[i + 1];
      if (next === undefined) throw new UsageError(`flag ${display} requires a value`, [helpHint], "MISSING_VALUE");
      value = next;
      i++;
    }
    if (def.type === "strings") {
      const prev = (flags[name] as string[] | undefined) ?? [];
      flags[name] = [...prev, value];
    } else {
      flags[name] = value;
    }
  }
  return { flags, positionals };
}

export function str(p: Parsed, name: string): string | undefined {
  const v = p.flags[name];
  return typeof v === "string" ? v : undefined;
}

export function bool(p: Parsed, name: string): boolean {
  return p.flags[name] === true;
}

export function strs(p: Parsed, name: string): string[] {
  const v = p.flags[name];
  return Array.isArray(v) ? v : [];
}

export function fieldsOf(p: Parsed): string[] {
  const v = str(p, "fields");
  if (!v) return [];
  return v
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Reject surplus positionals (fail loud instead of silently ignoring). */
export function maxPositionals(p: Parsed, n: number, cmd: string): void {
  if (p.positionals.length > n) {
    throw new UsageError(`unexpected argument ${p.positionals[n]}`, [`Run \`but-axi ${cmd} --help\``], "UNEXPECTED_ARGUMENT");
  }
}
