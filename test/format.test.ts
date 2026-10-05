import { describe, expect, it } from "vitest";
import { UsageError } from "../src/errors.js";
import { ago, body, filterLines, filterRows, project, putList, render, renderError, subject, tildify, truncate, truncationHint, validateFields } from "../src/format.js";
import { AxiError } from "../src/errors.js";

describe("render", () => {
  it("renders TOON tables with counts and a help block", () => {
    const out = render({
      data: { count: "2 branches", branches: [{ name: "a", commits: 2, state: "unpushed" }, { name: "b", commits: 0, state: "pushed" }] },
      help: ["Run `but-axi push <branch>`", "Run `but-axi status`"],
    });
    expect(out).toBe(
      "count: 2 branches\nbranches[2]{name,commits,state}:\n  a,2,unpushed\n  b,0,pushed\nhelp[2]:\n  Run `but-axi push <branch>`\n  Run `but-axi status`\n",
    );
  });
  it("dedupes help lines and omits empty help", () => {
    expect(render({ data: { a: 1 }, help: ["x", "x"] })).toBe("a: 1\nhelp[1]:\n  x\n");
    expect(render({ data: { a: 1 } })).toBe("a: 1\n");
  });
  it("quotes values containing delimiters", () => {
    expect(render({ data: { rows: [{ s: "a,b" }] } })).toContain('"a,b"');
  });
  it("renders structured errors", () => {
    const out = renderError(new AxiError("boom", "BUT_ERROR", ["Run `but-axi status`"]));
    expect(out).toBe("error: boom\ncode: BUT_ERROR\nhelp[1]:\n  Run `but-axi status`\n");
  });
});

describe("empty states", () => {
  it("putList writes a definitive zero message", () => {
    const d: Record<string, unknown> = {};
    putList(d, "branches", [], "0 applied branches");
    expect(render({ data: d })).toBe("branches: 0 applied branches\n");
  });
});

describe("truncate", () => {
  it("truncates with a size hint", () => {
    const t = truncate("x".repeat(2847), 100, false);
    expect(t.truncated).toBe(true);
    expect(t.text.length).toBe(100);
    expect(truncationHint(t.total, "diff")).toBe("(truncated, 2847 chars total — use --full to see complete diff)");
  });
  it("--full disables truncation", () => {
    expect(truncate("x".repeat(500), 100, true).truncated).toBe(false);
  });
});

describe("fields", () => {
  const schema = { name: "branches", defaults: ["name", "state"], extras: ["stack", "review"] };
  it("projects defaults plus requested extras in schema order", () => {
    const rows = project([{ name: "a", state: "x", stack: "s1", review: null, junk: 1 }], schema, ["review", "stack"]);
    expect(rows).toEqual([{ name: "a", state: "x", stack: "s1", review: "" }]);
  });
  it("unknown field is a usage error (exit 2)", () => {
    expect(() => validateFields(["nope"], [schema], "status")).toThrow(UsageError);
    try {
      validateFields(["nope"], [schema], "status");
    } catch (e) {
      expect((e as UsageError).exitCode).toBe(2);
    }
  });
});

describe("query", () => {
  it("filters rows and lines case-insensitively", () => {
    expect(filterRows([{ p: "src/A.ts" }, { p: "b.md" }], "a.ts")).toEqual([{ p: "src/A.ts" }]);
    expect(filterLines("one\nTwo\nthree", "two")).toBe("Two");
    expect(filterRows([{ p: 1 }], undefined)).toEqual([{ p: 1 }]);
  });
});

describe("helpers", () => {
  it("tildify", () => {
    expect(tildify("/Users/ed/.local/bin/but-axi", "/Users/ed")).toBe("~/.local/bin/but-axi");
    expect(tildify("/opt/x", "/Users/ed")).toBe("/opt/x");
  });
  it("subject/body", () => {
    expect(subject("feat: x\n\nbody line")).toBe("feat: x");
    expect(body("feat: x\n\nbody line")).toBe("body line");
  });
  it("ago", () => {
    expect(ago(1000_000, 1000_000 + 5_000)).toBe("5s ago");
    expect(ago(0, 3 * 3600_000)).toBe("3h ago");
    expect(ago(undefined)).toBe("");
  });
});
