```text
██████╗ ██╗   ██╗████████╗████████╗     █████╗ ██╗  ██╗██╗
██╔══██╗██║   ██║╚══██╔══╝╚══██╔══╝    ██╔══██╗╚██╗██╔╝██║
██████╔╝██║   ██║   ██║      ██║       ███████║ ╚███╔╝ ██║
██╔══██╗██║   ██║   ██║      ██║       ██╔══██║ ██╔██╗ ██║
██████╔╝╚██████╔╝   ██║      ██║       ██║  ██║██╔╝ ██╗██║
╚═════╝  ╚═════╝    ╚═╝      ╚═╝       ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝
```

<h1 align="center">but-axi</h1>

GitButler CLI for agents, designed with [AXI](https://axi.md) (Agent eXperience Interface).

`but-axi` wraps the official GitButler [`but`](https://docs.gitbutler.com/cli-overview) CLI. It runs `but ... --json` underneath and returns token-efficient [TOON](https://github.com/toon-format/toon) output with counts up front, explicit empty states, truncated diffs, structured errors, and `help[]` next-step hints.
Mutations (commit, branch new, push, undo, redo, oplog restore) return their result and the updated workspace state in one call.
It is built for agents that drive version control through a shell.

## AXI principles

`but-axi` follows the [10 AXI principles](https://axi.md):

| # | Principle | How but-axi does it |
| - | --------- | ------------------- |
| 1 | Token-efficient output | TOON tables such as `branches[2]{name,commits,state}:` instead of raw JSON |
| 2 | Minimal default schemas | 3-4 fields per row. `--fields a,b` adds more |
| 3 | Content truncation | Patches over 3000 chars and commit bodies over 800 chars are cut, with a size hint and `--full` |
| 4 | Pre-computed aggregates | A `count:` line first: stacks, branches, commits, uncommitted, conflicts |
| 5 | Definitive empty states | `branches: 0 applied branches`, `hunks: 0 matching hunks`, `pushed 0 branches (already up to date)` |
| 6 | Structured errors and exit codes | `error:`, `code:`, `help[]` on stdout. Exit 0 ok, 1 error, 2 unknown command, flag, or field. Never prompts. Idempotent commit, branch new, push |
| 7 | Ambient context | `but-axi setup hooks` installs a SessionStart dashboard for Claude Code, Codex, and Cursor |
| 8 | Content first | Bare `but-axi` shows live workspace state, not help text |
| 9 | Contextual disclosure | Every output ends with `help[]` command templates. `-C <path>` is carried forward and runtime values stay placeholders like `<branch>` |
| 10 | Consistent help | `but-axi <command> --help` is short |

## Quick Start

You need GitButler with its `but` CLI, Git, and Node.js 22 or newer.

```sh
git clone https://github.com/edheltzel/but-axi.git
cd but-axi
npm install             # installs dependencies and builds dist/
npm link                # puts `but-axi` on your PATH
but-axi                 # home view for the current directory
but-axi setup hooks     # optional: dashboard at the start of every agent session
```

Then tell your agent:

```
Use `but-axi` for GitButler version control. Run `but-axi` first, then follow its help[] hints.
```

## Getting Started

This part is for people. It walks you through setting up but-axi for the agents you work with, one step at a time.

**1. Install what but-axi needs.**

- **GitButler.** Download the app from [gitbutler.com](https://gitbutler.com/downloads). Then turn on its command-line tool, `but`. The [GitButler CLI guide](https://docs.gitbutler.com/cli-overview) shows how.
- **Node.js 22 or newer.** Get it from [nodejs.org](https://nodejs.org/).
- **Git.** Most Macs already have it. If not, get it from [git-scm.com](https://git-scm.com/downloads).

Check that the tools are there. Each command should print a version number:

```sh
but --version
node --version
git --version
```

**2. Install but-axi.**

Open a terminal in the folder where you keep code, and run these four commands one at a time:

```sh
git clone https://github.com/edheltzel/but-axi.git
cd but-axi
npm install
npm link
```

The first command downloads but-axi from GitHub. `npm install` gets what it needs and builds it. `npm link` puts the `but-axi` command on your computer.
Keep the `but-axi` folder. The command runs from it.
To confirm it worked, run:

```sh
but-axi --version
```

You should see a version number such as `0.1.0`.

**3. Try it in a project.**

Open a terminal in a project that already uses GitButler and run:

```sh
but-axi
```

This is the home view. It is a short summary of where the project stands:

- `bin:` is where but-axi is installed.
- `description:` is one sentence about what but-axi does.
- `workspace:` is the project folder.
- `count:` gives the totals: stacks, branches, commits, files you have not committed yet, and conflicts.
- `upstream:` tells you whether the main branch has new work you have not pulled.
- `branches` lists each branch with its number of commits and whether it is pushed.
- `help` lists the commands that make sense to run next.

If the folder does not use GitButler yet, the home view says so. To turn GitButler on for a Git project, run `but setup` in that folder.

**4. Give your agents the dashboard (optional).**

```sh
but-axi setup hooks
```

From now on, each new Claude Code, Codex, or Cursor session that starts inside a GitButler project gets the home view up front, so the agent knows the state of the project from the start. In other folders the hook prints nothing.
Before it changes a settings file, but-axi saves a backup copy next to it. The output lists those backups.
Restart your agent apps so they load the hook. Codex may ask you to trust the new hook the first time.

To check which apps have the hook:

```sh
but-axi setup hooks --status
```

**5. Undo the hook setup (any time).**

```sh
but-axi setup hooks --uninstall
```

This removes only the but-axi entries and leaves your other settings alone.

**6. Uninstall but-axi (if you want to).**

```sh
but-axi setup hooks --uninstall
npm uninstall -g but-axi
```

## Install Notes

but-axi is not published to npm. Install it from a clone as shown above. `npm install` runs the `prepare` script, which builds `dist/`.
`npm link` creates the same symlink as `ln -s "$PWD/dist/bin/but-axi.js" "$(npm prefix -g)/bin/but-axi"`.
To update, run `git pull` and then `npm install` in the clone.
npm 12 turns off git dependencies by default (`allow-git=none`), so `npm install -g github:edheltzel/but-axi` does not work unless you change that setting.

### Session hook

```sh
but-axi setup hooks                      # install for every agent found (claude, codex, cursor)
but-axi setup hooks --agents claude      # only some agents
but-axi setup hooks --dry-run            # show what would change
but-axi setup hooks --status             # installed or not, per agent
but-axi setup hooks --uninstall          # remove the managed entries
```

| Agent | Config file | Hook |
| ----- | ----------- | ---- |
| Claude Code | `~/.claude/settings.json` | `hooks.SessionStart` group, plain text output |
| Codex | `~/.codex/hooks.json` | `hooks.SessionStart` group, plain text output (needs `[features] hooks = true` in `~/.codex/config.toml`) |
| Cursor | `~/.cursor/hooks.json` | `hooks.sessionStart` entry, output `{"additional_context": "..."}` |

Setup merges into the existing file and never replaces it. Each file it edits is first copied to `<file>.bak-but-axi-<timestamp>`.
Running setup again changes nothing (`already installed (no change)`), and a stale entry is repaired in place.
Install and uninstall find the entry by the marker `# but-axi hook session-start` in the command.
The hook command uses absolute paths to `node` and the script, so it works when an app starts with a short `PATH`.
The hook reads the session directory from the hook's stdin JSON (`cwd`, or Cursor's `workspace_roots`) and prints nothing outside a GitButler workspace or on any error.

Not covered: jcode (its `session_start` setting is a single command that is already in use) and omp (it uses TypeScript extensions and has no shell hook config).
Cursor note: Cursor has a [known issue](https://forum.cursor.com/t/sessionstart-hook-additional-context-is-never-injected-into-agents-initial-system-context/158452) where `sessionStart` `additional_context` can be dropped.

## Usage

```sh
but-axi                                  # home view: live workspace state + next steps
but-axi status                           # uncommitted files, branches, commits, with IDs
but-axi status --fields sha,author       # extra columns
but-axi diff                             # all uncommitted hunks + truncated patch
but-axi diff <id> --full                 # one file/commit/branch, complete patch
but-axi diff --query login               # only hunks and patch lines that match
but-axi show <commit-id|branch>          # commit details or branch commit list
but-axi commit -b <branch> -m "<msg>"    # commit everything, return new state
but-axi commit -m "<msg>" <id> <id>      # commit selected hunks/files
but-axi branch                           # applied + unapplied branches
but-axi branch new <name>                # idempotent create
but-axi push [<branch>] [--dry-run]      # push, return pushed refs + state
but-axi undo | but-axi redo              # oplog undo/redo, return new state
but-axi oplog [--limit 20]               # operation history
but-axi oplog snapshot -m "<msg>"        # on-demand snapshot
but-axi oplog restore <id>               # restore, return new state
but-axi -C ~/code/app status             # any command against another directory
```

Home view in a fresh workspace with two uncommitted files:

```text
$ but-axi -C /tmp/but-axi-demo/app
bin: /opt/homebrew/bin/but-axi
description: Agent-ergonomic GitButler CLI that wraps `but --json` with compact TOON views and combined actions
workspace: /private/tmp/but-axi-demo/app
count: 0 stacks; 0 branches; 0 commits; 2 uncommitted; 0 conflicts
upstream: up to date
branches: 0 applied branches
help[4]:
  Run `but-axi -C /tmp/but-axi-demo/app diff` to inspect 2 uncommitted
  Run `but-axi -C /tmp/but-axi-demo/app commit -b <branch> -m "<message>"`
  Run `but-axi -C /tmp/but-axi-demo/app status` for IDs, files and commits
  Run `but-axi -C /tmp/but-axi-demo/app --help` for all commands
```

A commit returns the new commit and the updated state in one call:

```text
$ but-axi -C /tmp/but-axi-demo/app commit -b feature/login -m "feat: add login helper"
committed:
  id: rqk
  sha: fb48aec
  branch: feature/login
  subject: "feat: add login helper"
workspace: /private/tmp/but-axi-demo/app
count: 1 stack; 1 branch; 1 commit (1 on unpushed branches); 0 uncommitted; 0 conflicts
upstream: up to date
branches[1]{name,commits,state}:
  feature/login,1,unpushed
help[3]:
  Run `but-axi -C /tmp/but-axi-demo/app push feature/login`
  Run `but-axi -C /tmp/but-axi-demo/app show rqk`
  Run `but-axi -C /tmp/but-axi-demo/app undo` to revert this commit
```

Push works the same way:

```text
$ but-axi -C /tmp/but-axi-demo/app push feature/login
result: pushed 1 branch
pushed[1]{branch,remote,from,to}:
  feature/login,origin,(new),fb48aec
workspace: /private/tmp/but-axi-demo/app
count: 1 stack; 1 branch; 1 commit (0 on unpushed branches); 0 uncommitted; 0 conflicts
upstream: up to date
branches[1]{name,commits,state}:
  feature/login,1,pushed
help[2]:
  Run `but pr new <branch> -m "<title>"` to open a PR (raw but)
  Run `but-axi -C /tmp/but-axi-demo/app status`
```

Long patches are cut with a size hint:

```text
patch_note: "(truncated, 24979 chars total — use --full to see complete diff)"
```

### Commands

| Command | Description |
| ------- | ----------- |
| *(none)* | Home view: `bin`, `description`, workspace, counts, branches, `help[]` |
| `status` | `uncommitted{id,path,change}`, `branches{id,name,commits,state}`, `commits{id,branch,subject}` |
| `diff [<id>]` | `hunks{id,path,status,lines}` plus a truncated `patch` |
| `show <id\|branch>` | Commit: id, sha, author, date, subject, body, files. Branch: commits, base, stackedOn |
| `commit` | `-m` (repeatable), `-b <branch>`, optional change IDs. Never opens an editor. With nothing to commit it prints `skipped` and exits 0 |
| `branch [list\|new\|show]` | List, create (an existing branch is reported as `already exists (no change)`), show |
| `push [<branch>]` | `--dry-run`, `--with-force`, `--no-verify`. Already pushed gives `pushed 0 branches` and exit 0 |
| `undo`, `redo` | Oplog undo or redo plus the new state |
| `oplog [list\|snapshot\|restore]` | `--limit <n>`, `-m <msg>`, `<id>` |
| `setup hooks` | `--status`, `--uninstall`, `--agents`, `--dry-run` |
| `hook session-start` | Hook entrypoint (`--agent claude\|codex\|cursor`) |
| `version` | Print the version |

### Global flags

- `-C <path>` runs against another directory. It is carried forward into `help[]`.
- `--fields a,b` adds columns from a list's extra fields. `<command> --help` lists them. An unknown field exits 2.
- `--full` turns off truncation and row caps.
- `--query <text>` (`-q`) keeps only matching rows and patch lines, and reports `query:` and `matched: N of M`.
- `--help` (`-h`) prints short help for any command.
- `--version` (`-v`) prints the version.

### Exit codes and errors

| Exit | Meaning |
| ---- | ------- |
| 0 | Success, including no-op results such as `skipped` or `already exists` |
| 1 | Runtime error from `but` or but-axi, such as not a workspace, unknown ID, or missing `-m` |
| 2 | Unknown command, unknown flag, unknown `--fields` value, or extra argument |

Errors go to stdout in the same TOON shape. Debug output goes to stderr, and only when `BUT_AXI_DEBUG=1` is set.

```text
$ but-axi status --verbose
error: unknown flag --verbose
code: UNKNOWN_FLAG
help[1]:
  Run `but-axi status --help` to see supported flags
```

### help[] hints

Each response ends with `help[N]:` lines, which are ready-to-run command templates.
Fixed context (`-C <path>`) is carried forward. Values the agent has to choose stay as placeholders (`<branch>`, `<id>`, `"<message>"`). Values known from the result, such as the branch a commit landed on, are filled in.

### Environment

- `BUT_AXI_BUT=/path/to/but` sets which `but` binary to use. By default but-axi looks on `PATH`, then in `/opt/homebrew/bin`, `/usr/local/bin`, and `~/.local/bin`.
- `BUT_AXI_NODE=/path/to/node` sets the node binary written into hook commands. The default is `/opt/homebrew/bin/node` when it exists.
- `BUT_AXI_DEBUG=1` writes the `but` invocations to stderr.

## Fallback to raw `but`

but-axi wraps the core loop: inspect, commit, branch, push, and undo.
For everything else, use `but` directly: `amend`, `absorb`, `squash`, `move`, `reword`, `uncommit`, `discard`, `resolve`, `apply`, `unapply`, `pull`, `pr`, `land`, `pick`, `worktree`, `setup`, `teardown`.
If you call one of these on but-axi, it exits 2 and tells you to use `but <command> --help`.
CLI IDs from `but-axi status` and `but-axi diff` are the same IDs `but` uses, so you can pass them straight to `but`.

## Agent skill

The `git-butler-axi` Agent Skill (`~/.agents/skills/git-butler-axi/SKILL.md` on the author's machine) teaches agents when to use but-axi, how to read its output, and when to fall back to raw `but`.
The hook gives an agent context at the start of every session. The skill gives it the full guide when it needs one.

## Development

```sh
npm install          # dependencies + build (prepare)
npm run build        # tsc -> dist/
npm test             # build + vitest (unit tests + CLI exit-code tests + a real `but` flow in /tmp)
```

The integration suite creates a throwaway repo and a bare remote under `/tmp`, runs `but setup`, then commits, pushes, and undoes there. It is skipped when `but` is not installed.

## License

MIT
