# Letting Wren Read Your Documents

Sometimes the thing you want Wren to know is too small to live on a website or too unstructured for a Discord channel. That's what documents are for.

A document is a plain text file you drop into Wren's data folder. Wren reads it once and uses it as a source of truth, the same as a channel or a website.

## When to use a document

Documents are great for:

- A short FAQ that doesn't deserve its own channel
- A cheat sheet of common punishments
- An escalation guide ("if a player is being racist in chat, do X; if they're griefing, do Y")
- The two-paragraph summary of your server's vibe
- Anything you want Wren to know that lives nowhere else

If the document is longer than about 30 lines, prefer a channel with pinned messages or a website. Documents work best when they're short.

## How to add a document

Wren stores documents in a per-server folder. The path looks like:

```
data/tenants/<your server ID>/manual/
```

`<your server ID>` is the Discord server ID. To find it: right-click your server icon, choose **Copy Server ID** (Developer Mode must be on).

### Step 1 — Create the folder if it doesn't exist

Inside Wren's project folder, run from a terminal:

```bash
mkdir -p data/tenants/<your server ID>/manual
```

### Step 2 — Drop in your text file

Save your notes as a plain `.txt` file. Avoid Word documents, PDFs, or anything fancy. Wren reads the bytes as text.

Example `data/tenants/123456789012345678/manual/escalation.txt`:

```
LACRP escalation guide

When a player is being racist or homophobic:
1. Kick them.
2. Take a screenshot.
3. Send the screenshot to a senior mod.
4. The senior mod decides if it becomes a ban.

When a player is griefing (driving into buildings on purpose):
1. Send them a warning.
2. If they keep doing it, kick.
3. If they come back and do it again, ban for one day.

For mass RDM (Random Death Match):
1. Immediate ban. No warning.
2. Log it as "Bolo" in POW so other staff see the flag.
```

### Step 3 — Tell Wren about it

Back in Discord:

```
/wren sources add kind:document ref:escalation.txt label:Escalation weight:1
```

### Step 4 — Refresh Wren's memory

```
/wren ingest run
```

Within a minute or two, Wren can answer questions about your escalation guide.

## Editing a document

Open the file in any text editor, change what you need, save. Then run `/wren ingest run` again. Wren will pick up your changes.

## Removing a document

```
/wren sources remove kind:document ref:escalation.txt
```

Then optionally delete the file from disk so Wren doesn't keep using it on a future ingest.

## What's next

If your server uses Discord's ticket feature, see [Wren and Your Tickets](tickets.md).
