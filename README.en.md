# dsh-personal-assistant

A personal-assistant bundle for **DeepSeek Harness** (DSH).

It does not reimplement capabilities — it **orchestrates** the ones DSH already provides:
memory (OpenViking), calendar / todo / reminders (DingTalk `dws`), plus its own
local notes backend and proactive (daily digest) injection.

[中文说明](README.md)

## Status

| Milestone | Scope | State |
|---|---|---|
| M0 | loadable bundle + isolated skill provider | ✅ |
| M1 | notes MCP backend + proactive daily digest | ✅ |
| M2 | cross-capability orchestration (memory + dws + notes) | ⬜ |
| M3 | high-risk skills (book / reply) + approval hardening | ⬜ |

## Install

```bash
dsh plugin --profile desktop add dsh-personal-assistant
# or from a local path
dsh plugin --profile desktop add ./dsh-personal-assistant
```

Verify:

```bash
dsh --profile desktop --dump-config   # the personal-assistant plugin group should appear
```

## What it provides

| Piece | Detail |
|---|---|
| `personalAssistant` service | orchestration runtime |
| `agent/session-start` hook | session bootstrap |
| `agent/pre-step` hook | injects a **once-per-session-per-day** digest (replayable message) |
| `personal-assistant` skill | intent routing + safety contract |
| Notes MCP | `pa__note_create` / `pa__note_search` / `pa__note_list` / `pa__note_delete` |

The digest is assembled from multiple pluggable sources and degrades silently:
calendar / todo via the `dws` CLI (skipped when absent) and recent notes from the
bundle's own local SQLite.

## Requirements

- **Node >= 24** for the notes backend (uses the built-in `node:sqlite`, no flag needed).
  The rest of the plugin loads on Node 22.19+.
- A DSH host providing the peer packages `@deepseek-ai/dsh-llm`,
  `@deepseek-ai/dsh-mcp-client`, `@deepseek-ai/dsh-skill-filesystem`.

## Configuration

See [`cordis.patch.yml`](cordis.patch.yml). Key switches: `proactiveEnabled`,
`dailyDigestEnabled`, `proactiveTokenBudget`, `digestIncludeCalendar`,
`digestIncludeTodo`, `digestIncludeNotes`, `noteStorePath`.

## Checks

```bash
npm run check       # syntax + version consistency
npm test            # notes MCP protocol smoke + digest smoke
npm run test:apply  # plugin contract smoke (requires DSH peer deps)
```

## License

MIT
