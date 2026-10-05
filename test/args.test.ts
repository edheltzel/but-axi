import { describe, expect, it } from "vitest";
import { parseArgs } from "../src/args.js";
import { UsageError } from "../src/errors.js";
import { splitCommand } from "../src/cli.js";

const spec = { message: { type: "strings" as const, short: "m" }, branch: { type: "string" as const, short: "b" }, "dry-run": { type: "boolean" as const } };

describe("parseArgs", () => {
  it("parses short/long/inline flags and positionals", () => {
    const p = parseArgs(["-m", "one", "--message=two", "-b", "feat", "nk", "--full", "--fields", "a,b"], spec, "commit");
    expect(p.flags.message).toEqual(["one", "two"]);
    expect(p.flags.branch).toBe("feat");
    expect(p.flags.full).toBe(true);
    expect(p.positionals).toEqual(["nk"]);
  });
  it("fails loud on unknown flags with exit 2", () => {
    try {
      parseArgs(["--bogus"], spec, "commit");
      throw new Error("no throw");
    } catch (e) {
      expect(e).toBeInstanceOf(UsageError);
      expect((e as UsageError).exitCode).toBe(2);
      expect((e as UsageError).message).toBe("unknown flag --bogus");
    }
  });
  it("missing value is a usage error", () => {
    expect(() => parseArgs(["-m"], spec, "commit")).toThrow(/requires a value/);
  });
  it("-- ends flag parsing", () => {
    expect(parseArgs(["--", "--weird"], spec, "x").positionals).toEqual(["--weird"]);
  });
});

describe("splitCommand", () => {
  it("allows -C before the command", () => {
    expect(splitCommand(["-C", "/tmp/x", "status", "--full"])).toEqual({ command: "status", rest: ["-C", "/tmp/x", "--full"] });
    expect(splitCommand([])).toEqual({ command: undefined, rest: [] });
  });
});
