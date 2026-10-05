import { encode } from "@toon-format/toon";
import { homedir } from "node:os";
import { AxiError, UsageError } from "./errors.js";

export type Row = Record<string, unknown>;

export interface Output {
  /** Ordered TOON payload. */
  data: Row;
  /** Next-step suggestions rendered as help[N]. */
  help?: string[];
}

/** Render `help[N]:` as one indented command template per line. */
export function renderHelp(help: string[]): string {
  if (help.length === 0) return "";
  return `help[${help.length}]:\n` + help.map((h) => `  ${h}`).join("\n");
}

/** Render a payload as TOON followed by help[]. Always ends with a newline. */
export function render(out: Output): string {
  const parts: string[] = [];
  if (Object.keys(out.data).length > 0) parts.push(encode(out.data));
  const help = renderHelp(dedupe(out.help ?? []));
  if (help) parts.push(help);
  return parts.join("\n") + "\n";
}

export function renderError(err: AxiError): string {
  return render({ data: { error: err.message, code: err.code }, help: err.help });
}

function dedupe(items: string[]): string[] {
  return [...new Set(items)];
}

/** Render an absolute path with the home directory shown as `~`. */
export function tildify(p: string, home = homedir()): string {
  if (!home) return p;
  if (p === home) return "~";
  if (p.startsWith(home + "/")) return "~" + p.slice(home.length);
  return p;
}

export interface Truncated {
  text: string;
  truncated: boolean;
  total: number;
}

/** Truncate long text to `limit` chars unless `full`. */
export function truncate(text: string, limit: number, full: boolean): Truncated {
  const total = text.length;
  if (full || total <= limit) return { text, truncated: false, total };
  return { text: text.slice(0, limit), truncated: true, total };
}

/** Standard size hint: `(truncated, 2847 chars total — use --full to see complete diff)`. */
export function truncationHint(total: number, what: string): string {
  return `(truncated, ${total} chars total — use --full to see complete ${what})`;
}

/** First line of a commit message. */
export function subject(message: string | null | undefined): string {
  return (message ?? "").split("\n")[0]!.trim();
}

/** Commit body (everything after the subject + blank line). */
export function body(message: string | null | undefined): string {
  const lines = (message ?? "").split("\n");
  return lines.slice(1).join("\n").replace(/^\s*\n/, "").trimEnd();
}

/** Human relative time from epoch milliseconds. */
export function ago(ms: number | null | undefined, now = Date.now()): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return "";
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 60) return `${d}d ago`;
  return new Date(ms).toISOString().slice(0, 10);
}

/** A list schema: default fields shown, plus extras available via --fields. */
export interface ListSchema {
  name: string;
  defaults: string[];
  extras: string[];
}

/** Validate --fields against every list schema a command renders. Unknown field => exit 2. */
export function validateFields(requested: string[], schemas: ListSchema[], cmd: string): void {
  const known = new Set(schemas.flatMap((s) => [...s.defaults, ...s.extras]));
  const unknown = requested.filter((f) => !known.has(f));
  if (unknown.length > 0) {
    const avail = schemas.map((s) => `${s.name}: ${[...s.defaults, ...s.extras].join(",")}`).join("; ");
    throw new UsageError(`unknown field${unknown.length > 1 ? "s" : ""} ${unknown.map((u) => `"${u}"`).join(", ")}`, [
      `Available fields — ${avail}`,
      `Run \`but-axi ${cmd} --help\``,
    ], "UNKNOWN_FIELD");
  }
}

/** Project rows to the schema's default fields plus any requested extras (in schema order). */
export function project(rows: Row[], schema: ListSchema, requested: string[]): Row[] {
  const extras = schema.extras.filter((f) => requested.includes(f));
  const cols = [...schema.defaults, ...extras];
  return rows.map((r) => {
    const out: Row = {};
    for (const c of cols) out[c] = normalize(r[c]);
    return out;
  });
}

function normalize(v: unknown): unknown {
  if (v === undefined || v === null) return "";
  return v;
}

/** Case-insensitive match of `query` against any primitive field of a row. */
export function rowMatches(row: Row, query: string): boolean {
  const q = query.toLowerCase();
  return Object.values(row).some((v) => {
    if (v === null || v === undefined) return false;
    if (typeof v === "object") return JSON.stringify(v).toLowerCase().includes(q);
    return String(v).toLowerCase().includes(q);
  });
}

export function filterRows<T extends Row>(rows: T[], query: string | undefined): T[] {
  if (!query) return rows;
  return rows.filter((r) => rowMatches(r, query));
}

/** Keep only lines containing `query` (case-insensitive). */
export function filterLines(text: string, query: string | undefined): string {
  if (!query) return text;
  const q = query.toLowerCase();
  return text
    .split("\n")
    .filter((l) => l.toLowerCase().includes(q))
    .join("\n");
}

/**
 * Put a list into `data` as `name[N]{...}` rows, or as a definitive empty state
 * (`name: "0 <noun>"`) when there are no rows.
 */
export function putList(data: Row, key: string, rows: Row[], emptyText: string): void {
  if (rows.length === 0) data[key] = emptyText;
  else data[key] = rows;
}

export function plural(n: number, one: string, many = one + "s"): string {
  return `${n} ${n === 1 ? one : many}`;
}
