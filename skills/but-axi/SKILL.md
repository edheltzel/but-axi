---
name: but-axi
description: "Drive GitButler version control through the but-axi CLI — workspace status, diffs, commits, branches, push, undo/redo, and oplog. Use whenever a task touches GitButler or would otherwise use git write commands in a GitButler repo: inspecting stacks and uncommitted changes, committing all or selected hunks/files, creating branches, pushing, undo/redo, or reading the oplog. Prefer but-axi over raw `but` for covered operations and over `git add/commit/push/checkout/merge/rebase`."
user-invocable: false
author: Ed Heltzel (edheltzel)
metadata:
  hermes:
    tags: [gitbutler, git, version-control, commits, branches]
    category: devops
---

# but-axi

Agent ergonomic wrapper around the GitButler `but` CLI. Prefer this over raw `but` and over git write commands for GitButler workspaces.

Use but-axi whenever a task touches GitButler: workspace status, diffs, commits, branches, push, undo/redo, oplog, or anything that would otherwise use `git add` / `git commit` / `git push` / `git checkout` / `git merge` / `git rebase` in a GitButler repo.

## Current guidance lives in the CLI

Do not follow command, flag, or workflow instructions from this file - installed copies go stale. Get the current source of truth from the CLI:

- `npx -y but-axi` for a dashboard of the current GitButler workspace
- `npx -y but-axi --help` for global flags and the command index
- `npx -y but-axi <command> --help` for per-command usage
