# Glossary

Plain-English definitions for every term the rest of the guide uses.

## Bot

A program that lives inside Discord and responds to messages. Wren is a bot. Other bots you may have heard of: MEE6, Dyno, Carl-bot.

## Channel

A text or voice room inside a Discord server. Channels can be public (everyone sees them), private (only some roles see them), or threads (side conversations inside a channel).

## Channel ID

A long number that uniquely identifies a channel. Looks like `123456789012345678`. To copy one: enable Developer Mode in Discord's user settings, then right-click the channel and choose **Copy Channel ID**.

## Command prefix

Some bots respond when you type a special character followed by a command, like `!ban`. Wren doesn't use prefixes — it uses slash commands (you type `/` and a menu pops up) and pings (`@Wren`).

## Core info

A short note you store with `/wren config core-info` that Wren always carries in its head. Use it for things that should be true for every question Wren answers: your server name, your timezone, your community's vibe.

## Developer Mode

A Discord setting (User Settings → Advanced) that lets you right-click and copy IDs for users, channels, servers, and messages. Turn it on whenever you need to copy an ID.

## ERLC

**Emergency Response: Liberty County**, a Roblox game. Wren was built for ERLC communities but works in any Discord server.

## Ingest

The process of reading your sources (channels, websites, documents) and turning them into something Wren can search. You trigger it with `/wren ingest run`. Wren does this once after setup and again whenever sources change.

## Mention

A way to get a user's (or bot's) attention in Discord. You type `@username`. Wren only responds when mentioned or when replied to.

## Moderator (mod)

A Discord member with permission to take actions in your server. Wren recognises moderators by the roles you map under `/wren roles set`.

## Permission

A specific thing a user is allowed to do (delete messages, ban members, manage roles, etc.). Wren's permissions are not Discord's permissions — they're the rules in `/wren policy view`.

## Policy

The table Wren uses to decide who can do what. See `/wren policy view` to see yours. The policy is per-server, not global.

## Rank

One of five labels Wren attaches to every user: `owner`, `admin`, `mod`, `staff`, `user`. Wren computes your rank from your Discord role + permissions each time it needs to.

## Reply context

When you hit Reply on a Discord message and write a new one, Discord remembers which message you replied to. Wren uses this to know you're talking to it even if you didn't @mention.

## Server (Discord)

The whole Discord community — the equivalent of a single Discord "guild." When this guide says "your server," it means the Discord community, not a computer.

## Server key

The secret token Wren uses to talk to your ERLC server via the PRC API. Stored encrypted. Set with `/wren config erlc server-key:<key>`.

## Slash command

A command you run by typing `/`. Discord shows a menu of available commands. Wren's slash commands are all under `/wren`.

## Source of truth

Somewhere Wren can read. Three kinds: channel, website, document.

## Tenant

One Discord server's worth of Wren configuration. Every Discord server Wren joins gets its own tenant — its own rules, its own settings, its own data. The term is borrowed from software: think of it as "one customer" of the Wren service.

## Ticket

A private channel someone can open in your server to ask for help. Most servers use Discord's built-in ticket system. Wren can post a greeting when a new ticket opens.

## Token

A long secret string Wren uses to prove who it is when talking to another service. There are three kinds: the Discord bot token, the Mistral API key, and the Brave Search API key. There's also a per-server Wren API token, which is different.

## Tool

A thing Wren can do on your behalf. Examples: ban a player, fetch a Discord message, summarise a chat. Wren's full tool list is documented in [Command Reference](commands.md).

## Vector store

A database of "meanings" — pieces of text turned into lists of numbers, with a way to find similar pieces quickly. Wren uses a vector store to find the right section of your rulebook when answering a question.

## Weight

A number from 0 to 2 that controls how much Wren prefers one source over another. Higher weight = Wren leans on it more. Set with `/wren sources add` or `/wren sources list`.

## Wren

That's the bot this guide is about. Hi.
