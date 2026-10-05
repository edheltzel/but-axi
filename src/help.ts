export const TOP_HELP = `usage: but-axi [command] [flags]
description: Agent-ergonomic GitButler CLI. Wraps \`but ... --json\` with TOON output, counts, help[] hints.
no command: home view (bin, workspace state, branches, next steps)
commands[12]:
  status                       Uncommitted files, branches, commits with IDs
  diff [<id>]                  Changed files + truncated patch (uncommitted, or one commit/file/branch id)
  show <commit|branch>         Commit details or branch commit list
  commit -m <msg> [-b <branch>] [<id>...]   Commit (all or selected changes); returns new state
  branch [list]                Applied + unapplied branches
  branch new <name>            Create branch (idempotent); returns new state
  push [<branch>] [--dry-run]  Push branch(es); returns pushed refs + state
  undo | redo                  Undo/redo last operation; returns new state
  oplog [list|snapshot|restore]  Operation history
  setup hooks [--uninstall|--status]  Install SessionStart dashboard hook (Claude Code, Codex, Cursor)
  hook session-start           Hook entrypoint (quiet outside GitButler workspaces)
  version                      Print version
global flags: -C <path>, --fields a,b, --full, --query <text> (-q), --help (-h)
exit codes: 0 ok, 1 error, 2 unknown command/flag/field
not wrapped (use raw \`but\`): amend absorb squash move reword uncommit discard resolve apply unapply pull pr land pick worktree setup teardown
`;

export const COMMAND_HELP: Record<string, string> = {
  status: `usage: but-axi status [--fields <f,...>] [--query <text>] [--full]
Lists uncommitted changes, applied branches and their commits with CLI IDs.
fields: uncommitted(id,path,change +branch,conflicted) branches(id,name,commits,state +stack,upstream,review,conflicts) commits(id,branch,subject +sha,author,date,conflicted,changeId)
--full shows all commits (default first 20). --query filters every list.
`,
  diff: `usage: but-axi diff [<id>] [--full] [--query <text>] [--fields range]
No id: all uncommitted changes, one row per hunk (id <file>:<hunk>, usable with commit).
<id>: one uncommitted file, commit, committed file, or branch (CLI id from status).
Patch is truncated at 3000 chars unless --full. --query keeps matching hunks and patch lines.
`,
  show: `usage: but-axi show <commit-id|change-id|branch> [--full] [--query <text>] [--fields ...]
Commit: id, sha, author, date, subject, body (truncated at 800 chars), files.
Branch: commits (id,subject,files +sha,author,when,lines), base, stackedOn.
`,
  commit: `usage: but-axi commit -m <message> [-m <paragraph>...] [-b <branch>] [<change-id>...]
Commits all uncommitted changes, or only the listed file/hunk ids (from \`but-axi diff\`/\`status\`).
-b creates the branch if missing. Never opens an editor. Nothing to commit => exit 0, "skipped".
Returns the new commit plus updated workspace state.
`,
  branch: `usage: but-axi branch [list] [--query <text>] [--fields author,mergesCleanly,local,reviews]
       but-axi branch new <name> [--above <branch|commit>] [--below <branch|commit>]
       but-axi branch show <name>
\`branch new\` is idempotent: an existing branch reports "already exists (no change)" with exit 0.
`,
  push: `usage: but-axi push [<branch>] [--dry-run] [--with-force] [--no-verify]
No branch: pushes every branch with unpushed commits. Already pushed => "pushed 0 branches", exit 0.
--dry-run lists what would be pushed. Returns pushed refs plus updated branch states.
`,
  undo: `usage: but-axi undo
Reverts the last GitButler operation (oplog). Returns the new workspace state. See also: redo, oplog.
`,
  redo: `usage: but-axi redo
Re-applies the last undone operation. Returns the new workspace state.
`,
  oplog: `usage: but-axi oplog [list] [--limit <n>] [--full] [--query <text>] [--fields title,body,sha]
       but-axi oplog snapshot [-m <message>]
       but-axi oplog restore <id>
Lists recent operations (default 10). restore returns the new workspace state.
`,
  setup: `usage: but-axi setup hooks [--agents claude,codex,cursor] [--dry-run]
       but-axi setup hooks --status
       but-axi setup hooks --uninstall [--agents ...]
Installs a SessionStart hook that prints the home view at the start of each agent session
(silent outside GitButler workspaces). Merges into existing config, backs up each file it edits
(<file>.bak-but-axi-<timestamp>), and is idempotent. Targets: ~/.claude/settings.json,
~/.codex/hooks.json, ~/.cursor/hooks.json.
`,
  hook: `usage: but-axi hook session-start [--agent claude|codex|cursor]
Hook entrypoint. Prints the compact home view for the session directory; prints nothing (exit 0)
outside a GitButler workspace or on any error. --agent cursor wraps output as {"additional_context": ...}.
`,
  version: `usage: but-axi version
`,
};
