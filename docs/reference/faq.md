# Frequently Asked Questions

## General

**What does Wren cost?**

Wren's cost is determined by the host you get it from. The bot itself is free and open source — you only pay for the infrastructure (a small server, a database, a Mistral API key). Ask your host for the exact pricing.

**Does Wren work outside of ERLC?**

Yes. Wren was built for ERLC communities but the parts that answer rules questions, look up players, and chat with moderators work in any Discord server. The bits that touch the in-game server (kicks, bans, teleports) need an ERLC server key.

**Can I run Wren on my own computer?**

Yes. Wren is open source. You'll need a Discord bot token, a Mistral API key, a Brave Search API key, a Postgres database, and a place to run a Node.js process 24/7.

**Does Wren speak languages other than English?**

Wren answers in whatever language you write your question in. If you ask in Spanish, Wren answers in Spanish. The quality of answers depends on the quality of your sources — if your rulebook is in English, Wren's English answers will be best.

## Setup

**I invited Wren but it doesn't reply.**

Most often: you haven't run `/wren setup` yet. Type `@Wren` in any channel — if Wren replies "this server is not configured with Wren yet," that's the missing step.

**How do I find a channel ID?**

In Discord, go to **User Settings → Advanced** and turn on **Developer Mode**. Then right-click any channel and choose **Copy Channel ID**.

**I ran `/wren setup` twice. Did I break anything?**

No. Setup is idempotent — running it again is a no-op.

**Can I run Wren in multiple servers from one host?**

Yes. That's the whole point of the multi-tenant design. Each server gets its own configuration, its own rules, its own ban list. One Wren host can serve many Discord servers.

## Sources

**I added a source but Wren doesn't use it.**

Run `/wren ingest run`. Adding a source doesn't automatically re-read everything.

**Wren gave a wrong answer. What do I do?**

Two common causes:

1. The answer isn't actually in your sources. Add the rule to your rules channel, your website, or a document.
2. Your sources contradict each other. Pick the one you want Wren to prefer and raise its weight.

**My website is private / behind a login.**

Wren can only read pages it can fetch without logging in. If your handbook is in a private wiki, paste the relevant sections into a channel or a document Wren can read.

## Permissions

**A moderator says Wren said "permission denied."**

They tried to do something their rank doesn't allow. Either their Discord role isn't mapped in `/wren roles set`, or the policy is set too restrictive. Check `/wren policy view` and `/wren roles view`.

**Can I make Wren ignore the server owner?**

No. The server owner is always rank `owner` and can do anything Wren allows.

**Can I give one specific mod more power than everyone else?**

Yes — give them an extra role that's mapped to a higher slot, or map a role that only they have.

## Tickets and raids

**Wren isn't greeting new tickets.**

Check that `/wren config ticket-category` is set to the right category. Open a test ticket and see if the greeting appears.

**Wren keeps banning innocent players.**

Lower the threshold. As of this writing, the raid detection trips when a player runs more than 6 commands in 30 seconds. Edit `DEFAULT_RULE_THRESHOLD` in `src/discord/raidMonitor.js`, or turn off auto-ban with `/wren config raid-auto-punish enabled:false` and rely on alerts only.

## Something else?

See [Something Not Working?](troubleshooting.md).
