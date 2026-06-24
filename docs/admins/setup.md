# Setting Up Your Server

This guide is for the server owner. It assumes Wren is already in your server and you've run `/wren setup`.

## The five things every server should configure

In order of importance:

1. **Core info** — the always-on note Wren carries in its head.
2. **Sources of truth** — where your rules actually live.
3. **A status channel** — where Wren posts errors and alerts.
4. **A ticket category** — if you use Discord's ticket system.
5. **Raid protection** — if your server gets raided often.

## Step 1 — Set the core info

Core info is the short note Wren always reads. Use it for the things that should never depend on a search: the name of your community, your timezone, who to ping in an emergency.

```
/wren config core-info text:LACRP is a serious-roleplay ERLC community. Timezone: Europe/Madrid. Code of conduct: respect, no RDM, no VDM, follow staff instructions.
```

Wren will reply "Saved." Edit it any time by running the command again with new text.

## Step 2 — Wire your channels

Tell Wren which channels matter. There are four you'll likely want.

**A status channel.** This is where Wren posts errors, alerts, and audit info. Pick a channel only your staff can see.

```
/wren config status-channel channel:#staff-bot
```

**An ERLC log channel.** If your community has a channel where every in-game command is mirrored, point Wren at it. Wren uses this to catch raids.

```
/wren config erlc-log-channel channel:#erlc-logs
```

**A ticket category.** If you use Discord's ticket feature, Wren will post a friendly hello whenever a ticket opens. Right-click the category, copy the ID, then:

```
/wren config ticket-category category:<paste the ID>
```

**A security role.** Pick the role your staff uses. Wren uses this when listing channels for a moderator.

```
/wren config security-role role:@Staff
```

## Step 3 — Connect to your in-game server

This part is optional. If you only want Wren to answer rules questions, skip it.

You'll need your ERLC server key from the PRC dashboard. Treat it like a password.

```
/wren config erlc server-key:<your key here>
```

Wren stores the key safely and never shows it again.

If you also use POW for punishment logging:

```
/wren config pow base-url:https://your-pow-url token:<your POW token> server-a-id:Server A server-b-id:Server B
```

Wren will refuse to log punishments until all four POW pieces are set.

## Step 4 — Tell Wren your in-game name

If Wren is meant to chat with players inside the game, give it a name they can message. Most servers use something like `:pm wren`.

```
/wren config in-game-handle handle::pm wren
```

## Step 5 — Set the bot's display name (optional)

By default Wren introduces itself as "Wren." If your community calls it something else — "Helper," "Mod Bot," your server's mascot — change it:

```
/wren config bot-name name:Helper
```

The display name appears in Wren's replies. It does not change the slash command name. That stays `/wren`.

## Step 6 — Set response style

If you want Wren to be more casual, more formal, or to follow a specific house style, use the response style field:

```
/wren config response-style text:Be friendly and casual. Use short sentences. No emojis unless asked.
```

## What's next

Now that Wren knows where it lives, teach it about your rules. See [Teaching Wren About Your Server](sources-of-truth.md).
