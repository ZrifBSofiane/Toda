# TODA — Deferred-Issues Tracker: Design Spec

- Date: 2026-10-27
- Status: Design approved by user; ready for implementation planning
- Project dir: `C:\Users\user\Documents\OpenCodeProjects\TODA`

## 1. Summary

TODA tracks issues and todos that were deliberately put aside during LLM-assisted work ("not a priority, we'll come back to it"), so they stop getting lost between sessions.

One plain-text ledger file per project (`TODA.md`) is the single source of truth. A standard MCP server exposes five tools that read and write that file. The file format is the contract: MCP clients get native tools, and everything else — humans, git, any LLM in any harness without the plugin — keeps direct Read/Edit access.

## 2. Problem

Deferred items live only in conversation context and die with the session. Existing trackers (GitHub Issues, Jira) are too heavy for micro-deferrals and cost network round-trips and auth to consult. Storage is not the failure mode — process is: the LLM forgets to check the backlog. TODA therefore pairs minimal storage with a protocol injected into every session via convention files (AGENTS.md / CLAUDE.md / .cursorrules).

## 3. Goals

- **G1** Capture a deferral in one tool call, in the same turn the decision is made.
- **G2** LLM-facing latency: one call, token-minimal responses (raw lines, no JSON envelopes, no prose padding).
- **G3** Human-readable at rest: opens in any editor, renders in repo browsers, diffs and merges in git.
- **G4** Cross-tool portable: any MCP client (ZCode, Claude Desktop/Code, Cursor, ...) gets the same five tools; non-MCP agents and humans use the file directly.
- **G5** Bounded token bill: the hot file holds open + recent items only; closed items are pruned to an archive file.

## 4. Non-goals (v1)

- Binary or database storage (evaluated and rejected — see §11).
- Resolving references via git or GitHub APIs: no shelling out, no network, no auth.
- Importing `// TODO` code comments.
- GUI/TUI, multi-user locking, priority numbers, cross-project global index.

## 5. Architecture

```
any MCP client (ZCode, Claude, Cursor, ...)     any other LLM / human / git
        │ toda_add / toda_list / ...                 │ direct Read/Edit
        ▼                                            ▼
  TODA MCP server (stdio, stateless)  ──reads/writes──►  TODA.md  (+ TODA-archive.md)
        └── store.ts: pure parse / serialize / add / move / prune logic
```

- The server holds no state between calls and no private database. If the server is uninstalled, the data survives untouched.
- One file per project at the project root. Path resolution per call: `TODA_FILE` env var if set, else `<process.cwd()>/TODA.md`. Clients launch stdio servers with the session's working directory, so tools always operate on the current project's file. The archive lives in the same directory as `TODA-archive.md`.

## 6. Storage format

### 6.1 Files

`TODA.md` (hot) and `TODA-archive.md` (cold), identical format, same directory.

### 6.2 Structure

Fixed three-line header, then sections `## Open`, `## Sleeping`, `## Done`:

```markdown
# TODA — deferred items
<!-- one item per line: ID STATUS OPENED WHERE WHAT / WHY / revive: TRIGGER [/ ref: REFS] [/ done: NOTE] -->
<!-- statuses: o=open, s=sleeping, x=done. Human edits are fine; tools preserve unknown lines. -->

## Open
D-017  o  2026-10-26  payments/stripe.ts:210  webhook retries can double-charge / cosmetic vs launch / revive: next payments work
D-016  o  2026-10-24  README.md  install docs stale after v2 / low-traffic page / revive: before v2.1 release / ref: 3f9c1a2 gh:#123

## Sleeping
D-012  s  2026-09-30  src/theme.css  dark-mode flicker on load / needs designer input / revive: designer available

## Done
D-009  x  2026-09-28  api/auth.py:44  rate limiter off-by-one / cosmetic vs launch / done: fixed in 3f9c1a2
```

Sections organize for humans; the status column is authoritative. The parser does not enforce section/status agreement (an item may legally sit in any section). Non-item lines — prose, hand-written notes, unrecognized formats — are preserved verbatim forever; rewrites never drop them.

### 6.3 Item line grammar

```
ID STATUS OPENED WHERE WHAT / WHY / SEGMENT*
```

- **ID**: `D-` + digits. Writer pads to 3 digits (`D-007`); parser accepts any count.
- **STATUS**: single char, `o` (open) | `s` (sleeping) | `x` (done/closed).
- **OPENED**: `YYYY-MM-DD`, set at creation from server-local date, never modified afterward (including by `toda_set` or `toda_prune`).
- **WHERE**: one whitespace-free token (a `file:line` path, a ticket id, or `-`). The writer replaces internal whitespace with `-`.
- Segments after WHERE are separated by the exact delimiter ` / ` (space-slash-space):
  - **WHAT**: first untyped segment (required at `toda_add`).
  - **WHY**: remaining untyped segments, joined with ` / ` (required at `toda_add`).
  - `revive: TRIGGER` — the condition to revisit (required at `toda_add`).
  - `ref: REFS` — optional; space-separated plain-text references (commit shas, `gh:#123`, tag names).
  - `done: NOTE` — optional; written by `toda_set` on closure (typically the fix commit or "wontfix").
- The parser accepts typed segments (`revive:`, `ref:`, `done:`) in any order. The writer emits canonical order: `WHAT / WHY / revive: ... / ref: ... / done: ...`.

### 6.4 Escaping and safety

- The delimiter is exactly ` / `. Writers replace any occurrence of ` / ` inside user-provided text with ` ; `. A single `/` (as in file paths) never splits.
- Newlines in user input are stripped: one item, one line, always.

### 6.5 IDs

Next ID = 1 + max ID found across `TODA.md` **and** `TODA-archive.md`, computed at each `toda_add` (no counter file to corrupt). The archive is only scanned when it exists. A same-millisecond race between two sessions is theoretically possible and acceptable (last-writer-wins; a visible duplicate is trivially renumbered by hand).

### 6.6 Auto-creation

`toda_add` creates the file (header + empty sections) if missing. `toda_init` does the same explicitly and is idempotent.

## 7. MCP server

### 7.1 Runtime

stdio transport, stateless, zero network. TypeScript (strict) on the official `@modelcontextprotocol/sdk`; zod for input validation; vitest for tests. Node ≥ 20 (host has 24.x, npm 11.x confirmed).

### 7.2 Tools

| Tool | Input | Behavior | Returns |
|---|---|---|---|
| `toda_init` | — | Creates `TODA.md` if missing (idempotent) | Status line + the protocol snippet (§8) |
| `toda_add` | `what*`, `why_deferred*`, `revive_when*`, `where?`, `status?` (default `o`), `ref?` | Appends the line (auto-creates file) | Assigned ID + the canonical line |
| `toda_list` | `status?` (default `["o","s"]`), `keyword?`, `ref?`, `include_archive?` (default false) | Filters items | Matching lines verbatim, one per line; plus one warning line if any unparsed lines were skipped |
| `toda_set` | `id*`, `status*` (`o`\|`s`\|`x`), `note?`, `ref?` | Updates status and moves the line to the matching section; when moving to `x`, appends/replaces the `done:` segment; `ref` merges into the `ref:` segment. Operates on the hot file only — pruned items are closed and therefore immutable | The updated line |
| `toda_prune` | `older_than_days?` (default 30) | Moves `x` items whose **opened date** is older than the cutoff into `TODA-archive.md` | Moved count |

`*` = required. `keyword` is a substring match against the whole line; `ref` is a substring match against the `ref:` segment only. `note` is only used when `status=x`.

### 7.3 Response conventions

List-type outputs are the raw canonical lines and nothing else, except a single optional trailing warning line. Errors are one line: cause + next action (e.g. `unknown id D-099; call toda_list to see current ids`).

## 8. Companion protocol

`toda_init` returns this snippet for the project's convention file (AGENTS.md for ZCode, CLAUDE.md for Claude Code, `.cursorrules` for Cursor — one paste per harness):

> **TODA rule:** When we defer an issue or idea, call `toda_add` in the same turn — never "at the end of the session". When starting a task, call `toda_list` and mention open items whose `revive:` trigger matches the task. When a fix lands, call `toda_set` with status `x` in the same turn.

Optional session-start hooks that auto-surface open items are documented in the README as a per-harness follow-up; v1 does not depend on them.

## 9. Error handling

- **Missing file**: `toda_add` auto-creates; `toda_list` returns an empty result plus a one-line hint to call `toda_init`.
- **Malformed lines**: preserved verbatim on every rewrite; `toda_list` reports their count once per call.
- **Concurrent sessions**: adds are pure appends (git merges them cleanly); `toda_set`/`toda_prune` are read-modify-write with last-writer-wins; git history is the safety net.
- **Invalid input**: zod validation errors name the offending field.

## 10. Tech stack, repo layout, delivery

- Stack: Node ≥ 20, TypeScript (strict), `@modelcontextprotocol/sdk`, zod, vitest. No other dependencies.
- Layout:
  ```
  package.json  tsconfig.json
  src/server.ts   # MCP wiring and tool registration only
  src/store.ts    # pure format logic: parse, serialize, add, set, prune (string in, string out)
  src/io.ts       # thin read/write layer (path resolution, fs calls)
  test/store.test.ts
  test/server.test.ts   # end-to-end over the SDK in-memory transport
  README.md       # format spec, registration snippets, troubleshooting
  docs/superpowers/specs/2026-10-27-toda-design.md
  ```
- Registration: clients configure `command=node`, `args=[<absolute path>/dist/server.js]`, at user/global scope so every project gets it. README carries copy-paste snippets for ZCode, Claude Desktop, Claude Code, and Cursor.

## 11. Decisions log (evaluated alternatives)

- **Binary/SQLite storage**: rejected. With an interface layer, the on-disk format is invisible to callers, so binary saves zero LLM tokens, and parsing KB-scale files is already sub-millisecond. It would cost git merge safety (binary conflicts resolve to one side, silently losing a concurrent session's appends), the codec-free direct-access path that G4 depends on, and hand-repairability. Escape hatch: `store.ts` is the single swap point if data scale ever demands a database backend.
- **Ref resolution** (git log lookups, tag existence, issue-state sync): deferred to v2 (`toda_show` candidate). References stay plain text; callers resolve them with ordinary git/gh commands.
- **Priority field**: rejected — `why_deferred` + `revive_when` carry more signal than a numeric score.
- **Single global index file**: deferred to v2; per-project files keep items findable and versioned with the code they belong to.
- **Standalone CLI**: not built now; the file format is identical, and a CLI can wrap `store.ts` later without migration.

## 12. Testing and acceptance

- **Unit (`store.test.ts`)**: parse/serialize round-trip; escaping of ` / `; newline stripping; ID assignment including archive max; `toda_set` section moves and `done:` segment handling; prune cutoff; unknown-line preservation; section/status mismatch tolerance.
- **End-to-end (`server.test.ts`)**: drives the built server over the SDK in-memory transport through every tool's happy path and error paths (missing file, unknown id, invalid input).
- **Manual acceptance**: register the server in ZCode at user scope; from a live session in a real project run `toda_init`, add two items, `toda_list` with a keyword, set one done with a ref, prune, and confirm `TODA-archive.md` appears.

## 13. v2 candidates (explicitly out of scope now)

`toda_show` pretty-printer with git context; session-start hooks; global cross-project index; standalone CLI binary; code-comment importer.
