# Memory Commands

Wren has two kinds of long-term memory: **server memory** (facts true for everyone in your community) and **user memory** (facts specific to one person). Wren carries these facts into every conversation.

## When to use memory

Use **server memory** for things that are true all the time for everyone:

- "Our community is called LACRP."
- "We use Europe/Madrid time."
- "New moderators should read the staff handbook before their first shift."

Use **user memory** for things that are true for one person:

- "CoolPlayer123 prefers short answers."
- "SeniorModSam is allergic to CAPS LOCK."
- "TrialModTom is on their first week."

## `/wren memory list`

Shows every fact Wren has stored.

```
/wren memory list
```

The reply groups server facts and user facts. Server facts look like `[#1 server] Our community is called LACRP.`. User facts include the user key they belong to.

## `/wren memory add`

Stores a new fact.

```
/wren memory add scope:<server|user> content:<the fact>
```

For server memory, you must be the server owner. For user memory, you can store a fact about yourself (`scope:user` makes it tied to your Discord ID), and any moderator with the right rank can store user facts about anyone.

Examples:

```
/wren memory add scope:server content:Our server's in-game code is LAPRP.
/wren memory add scope:user content:SeniorModSam prefers bullet points over paragraphs.
```

## `/wren memory remove`

Deletes a fact by its ID.

```
/wren memory remove id:5
```

The ID is the number in front of the fact when you run `/wren memory list`.

## How Wren uses memory

Every time Wren prepares to answer a question, it builds a small section of its system prompt that lists all the relevant facts. So when you ask Wren about a player it knows, it sees their preferences; when you ask about your community, it sees the server facts.

This means memory is **stronger than sources**. If you store "we use 24-hour time" as a server fact, Wren will follow that even if your rules channel says "use AM/PM."

## Privacy

- User facts are only visible to people with `Manage Server`.
- Wren never reveals a user's stored fact to another user. If SeniorModSam has "prefers bullet points" stored, asking "what does Sam prefer?" from someone else's account will not return that fact.
- Memory is per-server. Two servers using the same Wren instance don't share facts.

## Memory vs. core info

**Core info** is set with `/wren config core-info` and is a single big text block. Use it for things like the timezone or the community name.

**Memory** is a list of small individual facts. Use it for lots of small things.

If you find yourself with more than 5 or 6 memory items, consider whether the same content could be a source of truth (a channel, a website, or a document) instead. Sources scale better than memory.

## What's next?

[Ingest Commands](ingest.md) — for when your sources have changed and Wren needs to re-read them.
