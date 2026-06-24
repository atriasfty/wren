# Asking About Players

Half of moderator work is "wait, who is this person?" Wren is built to answer those questions fast.

## Quick lookups

```
@Wren Is CoolPlayer123 online?
@Wren Is CoolPlayer123 staff?
@Wren What team is CoolPlayer123 on?
```

Wren answers in one line. If the player is offline, Wren tells you.

## Lookup shortcuts

- **`@Wren who is online?`** — list everyone currently online, grouped by rank (owner, admin, mod, regular).
- **`@Wren server stats`** — quick summary: players, max slots, staff count, server name.

## Whitelists and perks

If your server uses Discord roles to grant in-game perks (whitelist, booster perks, premium lanes), Wren can check them for any player:

```
@Wren Does CoolPlayer123 have the whitelist role?
@Wren What perks does CoolPlayer123 have?
```

For this to work, your admin must have mapped the Discord role IDs to slots. If Wren says "no Discord link or guild context," let your admin know — they probably haven't set up the role slots yet.

## Punishment history

If your community uses POW for punishment logging:

```
@Wren Has CoolPlayer123 been punished on Server A?
@Wren What bans does CoolPlayer123 have on Server B?
```

Wren pulls the full history from POW. It shows the type (warn, kick, ban, ban-bolo), the reason, the date, and which server it happened on.

If you want to log a punishment yourself:

```
@Wren Log a warn for CoolPlayer123 on Server A — spamming chat
```

Wren will write the punishment to POW for you. Most servers only allow senior moderators to do this, so you might see "permission denied" if your role is too junior.

## Recent activity

If a player is being weird and you want a summary of what they've been up to:

```
@Wren What has CoolPlayer123 been doing recently?
```

Wren pulls the player's recent in-game commands, joins, leaves, kills, and deaths, and gives you a one-paragraph summary.

## Taking action

When you want Wren to do something, just say so in plain English:

```
@Wren Ban CoolPlayer123 for 1 day — RDM at the casino
@Wren Kick CoolPlayer123 — spam in chat
@Wren Bring everyone to me
@Wren Send a message to CoolPlayer123 — "Please read the rules before joining again."
```

Wren will confirm what it's about to do and then do it. If your role isn't allowed to take that action, Wren will tell you instead of doing it silently.

## A note on usernames

Wren searches by the **display name** players use in-game, not by their Discord handle. If you're not sure of the exact spelling, give Wren your best guess — Wren will find the closest match.

## What's next

If you're not sure what Wren will or won't do for your role, see [What Wren Will Not Do](limits.md).
