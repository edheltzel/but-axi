import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { TOP_HELP } from "../src/help.js";
import { createSkillMarkdown, MAX_SKILL_MARKDOWN_CHARS } from "../src/skill.js";

describe("skill stub", () => {
  it("matches the committed skills/but-axi/SKILL.md", () => {
    const committed = readFileSync(new URL("../skills/but-axi/SKILL.md", import.meta.url), "utf8");
    expect(committed).toBe(createSkillMarkdown());
  });

  it("stays a short stub that defers to the CLI", () => {
    const markdown = createSkillMarkdown();
    expect(markdown.length).toBeLessThanOrEqual(MAX_SKILL_MARKDOWN_CHARS);
    expect(markdown).toContain("user-invocable: false");
    expect(markdown).toContain("npx -y but-axi");
    expect(markdown).toContain("npx -y but-axi --help");
    expect(markdown).toContain("npx -y but-axi <command> --help");
    expect(markdown).toMatch(/stale/);
    expect(markdown).not.toContain("commands[");
    expect(markdown).not.toContain(TOP_HELP.trim());
    expect(markdown).not.toMatch(/^## Commands/m);
    expect(markdown).not.toMatch(/^## Workflow/m);
  });
});
