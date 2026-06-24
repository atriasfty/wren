# Ingest Commands

Ingestion is the process of reading everything you've told Wren about and turning it into something Wren can search. You run it once after setup, then again whenever your sources change.

## What "ingest" actually does

When you run ingest, Wren:

1. Visits every enabled channel and pulls recent messages.
2. Visits every enabled website and downloads the text.
3. Reads every enabled document from disk.
4. Chops all of it into small pieces (about a paragraph each).
5. Turns each piece into a vector (a list of numbers that captures meaning).
6. Saves the vectors to disk.

The whole thing is what lets Wren find the right section of your rulebook when a moderator asks about RDM. Without it, Wren is just a chatbot that doesn't know anything about your server.

## `/wren ingest run`

Builds the search index.

```
/wren ingest run
```

You'll see a "thinking…" message from Discord while Wren works. The first run after setup typically takes 2 to 5 minutes. Later runs (when only one source has changed) are much faster.

### Picking what to ingest

By default, `/wren ingest run` reads everything. If you've just changed a website and don't want to wait for channels to re-read, you can target a single kind:

```
/wren ingest run kind:websites
/wren ingest run kind:channels
/wren ingest run kind:documents
```

The `kind:` option is optional. Leave it off for the default ("read everything").

### Who can run it

Only the **server owner** can run ingest. It's a heavy operation and there's no reason for a regular moderator to need it.

## `/wren ingest status`

Shows when each source was last read.

```
/wren ingest status
```

If a source has never been ingested, it shows a yellow clock. If it has, it shows a green tick and the timestamp of the last successful run.

If a source you expected to be there is missing, check `/wren sources list` — it may not be configured.

## When to run ingest

- **Right after setup** — to build the first index.
- **After adding or changing a source** — so Wren sees the new content.
- **After a major rules update** — so Wren's answers reflect the new wording.
- **Weekly** — as a routine, in case Discord channel history scrolled past Wren's read window.

## If ingest fails

Wren will reply with an error message. The common causes:

- **Channel ID is wrong.** Double-check by running `/wren sources list` and trying the channel again.
- **Website is unreachable.** The site might be down, behind a login, or blocking Wren's user agent. Try fetching it in your own browser.
- **Document file missing.** Make sure the file is in `data/tenants/<server ID>/manual/` and the filename matches what you used in `/wren sources add`.

If the error message is unhelpful, ask your Wren host — they have access to the logs.

## What's next?

For the bigger picture, see [What Wren Does](../getting-started/what-it-does.md) or jump to [Frequently Asked Questions](faq.md).
