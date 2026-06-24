# All `/wren` Commands

Wren's slash commands are grouped by what they do. Most require **Manage Server** permission. A few — like ingestion — require the server owner.

| Group | What it's for |
|---|---|
| `/wren setup` | First-time setup. Creates your server's settings. |
| `/wren config` | Server settings: name, channels, behaviour. |
| `/wren sources` | Where Wren reads rules and guides from. |
| `/wren policy` | What different moderator ranks are allowed to do. |
| `/wren roles` | Maps your Discord roles to Wren's role slots. |
| `/wren bans` | People who can't use Wren. |
| `/wren memory` | Facts Wren should remember. |
| `/wren ingest` | Rebuilds Wren's search index. |

## Reading order

If you've just invited Wren, read the pages in this order:

1. [Setup](../admins/setup.md) — covers `/wren setup` and the config commands.
2. [Sources of Truth](../admins/sources-of-truth.md) — covers `/wren sources`.
3. [Policy](policy.md) — when you want fine-grained control over who can do what.
4. [Roles](roles.md) — when you want Wren to know which Discord role is which.
5. [Bans](bans.md) — when you need to block a user from using Wren.
6. [Memory](memory.md) — for facts Wren should always carry in its head.
7. [Ingest](ingest.md) — when sources have changed and Wren needs to re-read them.

## Command summaries

For the full reference of every subcommand and option, see each group's page. The summaries below are the cheat sheet.

### `/wren setup`

Run once per server. No options. Idempotent — running it twice doesn't break anything.

### `/wren config`

| Subcommand | What it sets |
|---|---|
| `view` | Shows all your current settings. |
| `set` | Free-form set of any allowed key. |
| `core-info` | The always-on note Wren carries. |
| `response-style` | How Wren should sound (formal, casual, etc.). |
| `bot-name` | The name Wren introduces itself as. |
| `in-game-handle` | How players reach Wren in-game. |
| `raid-auto-punish` | Whether Wren should auto-ban raid alerts. |
| `status-channel` | Where Wren posts errors and alerts. |
| `erlc-log-channel` | Where mirrored in-game commands go. |
| `ticket-category` | Where Wren watches for new tickets. |
| `security-role` | The role Wren uses to list channels. |
| `raid-alert` | Channel and role for raid warnings. |

See [Configuration Commands](config.md) for the full list.

### `/wren sources`

| Subcommand | What it does |
|---|---|
| `list` | Show every source. |
| `add` | Add a channel, website, or document. |
| `remove` | Stop using a source. |
| `toggle` | Turn a source on or off without deleting it. |

See [Source Commands](sources.md).

### `/wren policy`

| Subcommand | What it does |
|---|---|
| `view` | Show the permission table. |
| `set` | Change who can do what. |

See [Policy Commands](policy.md).

### `/wren roles`

| Subcommand | What it does |
|---|---|
| `view` | Show your role slot mappings. |
| `set` | Map a Discord role to a Wren slot. |

See [Role Commands](roles.md).

### `/wren bans`

| Subcommand | What it does |
|---|---|
| `list` | Show every banned user. |
| `add` | Block a user from using Wren. |
| `remove` | Unblock them. |

See [Ban Commands](bans.md).

### `/wren memory`

| Subcommand | What it does |
|---|---|
| `list` | Show stored facts. |
| `add` | Save a fact Wren should remember. |
| `remove` | Delete a fact. |

See [Memory Commands](memory.md).

### `/wren ingest`

| Subcommand | What it does |
|---|---|
| `run` | Rebuild Wren's search index. |
| `status` | Show when each source was last read. |

See [Ingest Commands](ingest.md).

## What next?

Pick the page for whatever you want to change first. Start with [Configuration Commands](config.md) if you haven't done the initial setup yet.
