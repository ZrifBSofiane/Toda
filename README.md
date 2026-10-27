# TODA — deferred-issues tracker

Tracks issues deliberately put aside during LLM-assisted work ("not a priority, later"),
so they stop getting lost between sessions. One plain-text ledger per project
(`TODA.md`) is the single source of truth; a stateless stdio MCP server provides five
tools over it. No network, no database, sub-millisecond operations.

- Spec: `docs/superpowers/specs/2026-10-27-toda-design.md`
- Format: one item per line —
  `D-017  o  2026-10-26  payments/stripe.ts:210  what / why-deferred / revive: trigger [/ ref: REFS] [/ done: NOTE]`
- The file is the contract: humans and non-MCP LLMs can Read/Edit `TODA.md` directly.
  Unknown lines are preserved verbatim by all tools.

## Tools

| Tool | Purpose |
|---|---|
| `toda_init` | Create `TODA.md` (idempotent); returns the convention-file snippet |
| `toda_add` | Append an item (`what`, `why_deferred`, `revive_when`, optional `where`, `status`, `ref`) |
| `toda_list` | List items (default open + sleeping; `keyword`, `ref`, `status`, `include_archive` filters) |
| `toda_set` | Change status (`o`/`s`/`x`), optional closure `note` and `ref` merge |
| `toda_prune` | Move done items older than N days (default 30) to `TODA-archive.md` |

## Convention-file snippet (paste into AGENTS.md / CLAUDE.md / .cursorrules)

> **TODA rule:** When we defer an issue or idea, call `toda_add` in the same turn —
> never "at the end of the session". When starting a task, call `toda_list` and mention
> open items whose `revive:` trigger matches the task. When a fix lands, call `toda_set`
> with status `x` in the same turn.

## Build

    npm install
    npm test
    npm run build

## Register the server (user/global scope, so every project gets it)

Absolute path to the built entry: `<this repo>/dist/main.js`.

JSON form (Claude Desktop `claude_desktop_config.json`, Cursor `mcp.json`, ZCode/Claude Code `mcpServers` config):

    {
      "mcpServers": {
        "toda": {
          "command": "node",
          "args": ["C:\\path\\to\\TODA\\dist\\main.js"]
        }
      }
    }

CLI form (Claude Code / ZCode — confirm exact flags with `--help` first):

    claude mcp add --scope user toda -- node "C:\path\to\TODA\dist\main.js"
    zcode mcp add --scope user toda -- node "C:\path\to\TODA\dist\main.js"

## Notes

- `TODA.md` is resolved from the session's working directory; set the `TODA_FILE`
  env var in the server config to pin an explicit path.
- Closed items stay in the hot file until `toda_prune` archives them; the archive
  is only read when `include_archive` is set, keeping the token bill bounded.
- References are stored as plain text and never resolved (no git/GitHub calls).
