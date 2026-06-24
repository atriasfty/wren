# Source Commands

The `/wren sources` family tells Wren where to read your rules from.

A **source** is a place Wren can look. There are three kinds: **channel** (a Discord channel), **website** (a URL), and **document** (a file on disk). You can have as many of each as you want.

## `/wren sources list`

Shows every source you have configured.

```
/wren sources list
```

Each row looks like:

```
✅ `channel` 123456789012345678 — Rules (w=1)
⛔ `website` https://example.com/old-handbook — Old handbook (w=0.5)
✅ `document` faq.txt — FAQ (w=1)
```

The green tick means the source is enabled. The red cross means it's currently disabled but still remembered. The number in `w=` is the retrieval weight.

## `/wren sources add`

Adds a new source.

```
/wren sources add kind:<kind> ref:<reference> label:<short name> weight:<0 to 2>
```

- `kind` — one of `channel`, `website`, `document`.
- `ref` — the channel ID, URL, or filename.
- `label` — a short human-readable name Wren will use when citing this source.
- `weight` — optional. Default `1`. Higher values make Wren prefer this source.

### Adding a channel

1. Right-click the channel in Discord (Developer Mode must be on in User Settings → Advanced).
2. Click **Copy Channel ID**.
3. Run:

```
/wren sources add kind:channel ref:123456789012345678 label:Rules weight:1.5
```

### Adding a website

```
/wren sources add kind:website ref:https://example.com/handbook label:Handbook weight:1
```

Wren pulls the text on the next ingest.

### Adding a document

First drop the file into `data/tenants/<your server ID>/manual/`. Then:

```
/wren sources add kind:document ref:escalation.txt label:Escalation weight:1
```

See [Letting Wren Read Your Documents](../admins/documents.md) for the full walkthrough.

## `/wren sources remove`

Deletes a source. The data on disk or the website stays where it is — only Wren's pointer to it is removed.

```
/wren sources remove kind:channel ref:123456789012345678
```

## `/wren sources toggle`

Turns a source on or off without removing it. Useful for temporarily silencing a chatty channel.

```
/wren sources toggle kind:channel ref:123456789012345678 enabled:false
```

Run again with `enabled:true` to bring it back.

## What does weight do?

Wren scores every chunk it retrieves by how relevant it is to the question. The score is then multiplied by the source's weight. Higher weight = that source wins ties.

A few good defaults:

- Your rules channel: `1.5`
- Your handbook website: `1`
- A general-discussion channel you still want indexed: `0.5`
- A document with strict escalation paths: `1.2`

If a source keeps coming up in answers and you'd rather it didn't, lower its weight. If you want it to dominate answers, raise it.

## After changing sources

Run `/wren ingest run` so Wren re-reads everything. If you don't, your new source won't be searchable yet.

## What's next?

[Policy Commands](policy.md) — for controlling who can do what.
