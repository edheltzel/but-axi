import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Leaf module: node builtins only.
 * `bin/but-axi.ts` imports this on the bare version fast path, so a new import
 * here would be paid on every `-v` / `-V` / `--version` probe.
 */
function readPackageVersion(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    for (const p of [join(here, "..", "package.json"), join(here, "..", "..", "package.json")]) {
      if (!existsSync(p)) continue;
      const version = JSON.parse(readFileSync(p, "utf8")).version;
      if (typeof version === "string" && version) return version;
    }
  } catch {
    /* ignore */
  }
  return "0.0.0";
}

export const VERSION = readPackageVersion();

const BARE_VERSION = new Set(["-v", "-V", "--version"]);

/** True when argv is only a version flag. Those probes must not load the command graph. */
export function isBareVersion(argv: string[]): boolean {
  return argv.length === 1 && BARE_VERSION.has(argv[0]!);
}
