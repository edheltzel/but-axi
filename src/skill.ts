/** Discovery stub only. Command guidance lives in `but-axi --help`, which does not go stale. */
export const SKILL_DESCRIPTION =
  "Drive GitButler version control through the but-axi CLI — workspace status, diffs, commits, branches, push, undo/redo, and oplog. Use whenever a task touches GitButler or would otherwise use git write commands in a GitButler repo: inspecting stacks and uncommitted changes, committing all or selected hunks/files, creating branches, pushing, undo/redo, or reading the oplog. Prefer but-axi over raw `but` for covered operations and over `git add/commit/push/checkout/merge/rebase`.";

export const SKILL_AUTHOR = "Ed Heltzel (edheltzel)";
export const HERMES_TAGS = ["gitbutler", "git", "version-control", "commits", "branches"];
export const HERMES_CATEGORY = "devops";

/** Hard cap so a regeneration cannot silently re-inflate the stub with CLI-owned instructions. */
export const MAX_SKILL_MARKDOWN_CHARS = 2500;

const BODY = `# but-axi

Agent ergonomic wrapper around the GitButler \`but\` CLI. Prefer this over raw \`but\` and over git write commands for GitButler workspaces.

Use but-axi whenever a task touches GitButler: workspace status, diffs, commits, branches, push, undo/redo, oplog, or anything that would otherwise use \`git add\` / \`git commit\` / \`git push\` / \`git checkout\` / \`git merge\` / \`git rebase\` in a GitButler repo.

## Current guidance lives in the CLI

Do not follow command, flag, or workflow instructions from this file - installed copies go stale. Get the current source of truth from the CLI:

- \`npx -y but-axi\` for a dashboard of the current GitButler workspace
- \`npx -y but-axi --help\` for global flags and the command index
- \`npx -y but-axi <command> --help\` for per-command usage
`;

/**
 * Render the installable SKILL.md stub.
 * Installed copies go stale; the CLI dashboard and `--help` stay current.
 */
export function createSkillMarkdown(): string {
  const markdown = `---
name: but-axi
description: ${JSON.stringify(SKILL_DESCRIPTION)}
user-invocable: false
author: ${SKILL_AUTHOR}
metadata:
  hermes:
    tags: [${HERMES_TAGS.join(", ")}]
    category: ${HERMES_CATEGORY}
---

${BODY}`;
  if (markdown.length > MAX_SKILL_MARKDOWN_CHARS) {
    throw new Error(`generated SKILL.md is ${markdown.length} chars; keep it a stub under ${MAX_SKILL_MARKDOWN_CHARS}`);
  }
  return markdown;
}
