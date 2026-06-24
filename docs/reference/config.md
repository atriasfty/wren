# Configuration Commands

The `/wren config` family controls how Wren behaves in your server.

## `/wren config view`

Shows every setting you have configured. Useful when you want to remember what you've already set.

```
/wren config view
```

Wren replies with an ephemeral message (only you can see it) listing each setting and its current value.

## `/wren config set`

The escape hatch. Lets you set any of the keys below without using a typed subcommand.

```
/wren config set key:<key name> value:<value>
```

For example:

```
/wren config set key:prcBaseUrl value:https://api.erlc.gg/v1
```

The key names are case-sensitive and use `camelCase`. Wren will tell you if you pick a key it doesn't recognise.

### Settable keys

- `displayName` — your server's friendly name.
- `botDisplayName` — the name Wren uses in replies.
- `inGameHandle` — how players reach Wren in-game.
- `prcBaseUrl` — ERLC API endpoint. Defaults to the official one.
- `powBaseUrl` — POW API endpoint.
- `powServerAId`, `powServerBId` — labels for your two ERLC servers in POW.
- `ticketCategoryId` — Discord ID of your tickets category.
- `securityRoleId` — Discord role ID Wren uses to list channels.
- `statusChannelId` — Discord channel where Wren posts alerts.
- `erlcLogChannelId` — Discord channel where mirrored in-game commands live.
- `raidAlertChannel` — Discord channel where raid warnings go.
- `raidAlertRole` — Discord role to ping on raid warnings.
- `coreInfo` — the always-on note.
- `responseStyle` — how Wren should sound.
- `raidAutoPunish` — `true` or `false`.

For the ERLC server key and POW token, use the dedicated subcommands — they are stored encrypted, and `set` won't accept them.

## `/wren config core-info`

Sets the always-on note Wren carries in its head.

```
/wren config core-info text:<your note here>
```

Use this for things that should never depend on a search: your server's name, your timezone, who to ping in emergencies.

## `/wren config response-style`

Sets the tone guidance.

```
/wren config response-style text:Be friendly and casual. Use short sentences.
```

If left blank, Wren is helpful and to the point by default.

## `/wren config bot-name`

Changes the name Wren introduces itself as.

```
/wren config bot-name name:Helper
```

This does not change the slash command name. That stays `/wren`.

## `/wren config in-game-handle`

How players reach Wren in-game.

```
/wren config in-game-handle handle::pm wren
```

Most servers use `:pm <name>` to send an in-game private message to the bot.

## `/wren config raid-auto-punish`

Whether Wren should auto-ban when it detects a raid.

```
/wren config raid-auto-punish enabled:true
```

Set `enabled:false` to turn auto-ban off. See [Catching Raiders Early](../admins/raid-protection.md) for the trade-offs.

## `/wren config status-channel`

Where Wren posts errors, alerts, and audit info.

```
/wren config status-channel channel:#staff-bot
```

## `/wren config erlc-log-channel`

Where your server's mirrored in-game commands live, if you have them.

```
/wren config erlc-log-channel channel:#erlc-logs
```

Wren uses this to spot raid patterns.

## `/wren config ticket-category`

Where Wren watches for new tickets.

```
/wren config ticket-category category:<paste category ID>
```

Right-click the category in Discord (with Developer Mode on) to copy the ID.

## `/wren config security-role`

The role Wren uses when listing channels for a moderator.

```
/wren config security-role role:@Staff
```

This should be the role your staff use, not the @everyone role.

## `/wren config raid-alert`

Where Wren posts raid warnings, and what role to ping.

```
/wren config raid-alert channel:#staff-alerts role:@Staff
```

The role is optional. Omit it if you don't want a ping.

## What's next?

See [Source Commands](sources.md) for adding the channels, websites, and documents Wren should read.
