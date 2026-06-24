# Teaching Wren About Your Server

This is the part of the guide that turns Wren from a chatbot into a helper that actually knows your community.

## What "sources of truth" means

A source of truth is somewhere Wren can read. When you ask Wren a question, it looks through every source you've given it, finds the pieces that look most relevant, and answers using those.

Wren supports three kinds of sources. You can mix and match as many as you like.

- **Channel** — a Discord channel. Best for pinned rules, FAQs, and active discussions.
- **Website** — any URL Wren can read. Best for handbooks, guides, and policies that live on a webpage.
- **Document** — a text file you've dropped into Wren's data folder. Best for short, structured notes (cheat sheets, escalation paths, the "if X then Y" list).

## Adding a source

The pattern is the same for every kind:

```
/wren sources add kind:<kind> ref:<reference> label:<short name> weight:<0 to 2>
```

The **weight** is how much Wren should prefer that source. The default is `1`. Higher weights mean Wren will lean on that source more; lower weights mean it will only use it when nothing else fits.

### Channel

1. In Discord, turn on Developer Mode (User Settings → Advanced).
2. Right-click the channel you want, choose **Copy Channel ID**.
3. Run:

```
/wren sources add kind:channel ref:123456789012345678 label:Rules weight:1
```

Wren will reply "Added source."

### Website

1. Find the URL of your handbook or guide.
2. Run:

```
/wren sources add kind:website ref:https://example.com/handbook label:Handbook weight:1
```

Wren pulls the text on the next ingest.

### Document

1. Drop the text file into the folder where Wren stores your server's data. By default this is `data/tenants/<your server ID>/manual/`. (Your host will tell you exactly where.)
2. Run:

```
/wren sources add kind:document ref:faq.txt label:FAQ weight:1
```

The filename you use in `ref` must match the file on disk.

## Listing your sources

See everything you've added:

```
/wren sources list
```

Each source is shown with a green tick if it's enabled, a red cross if it's not, and its current weight.

## Turning a source on or off

Useful when one channel is full of off-topic chatter and you don't want Wren quoting from it.

```
/wren sources toggle kind:channel ref:123456789012345678 enabled:false
```

You can turn it back on the same way with `enabled:true`.

## Removing a source

```
/wren sources remove kind:channel ref:123456789012345678
```

## Letting Wren read everything

After you add or change sources, Wren needs to refresh its memory of them. Run:

```
/wren ingest run
```

The first run takes a few minutes. Later runs are faster because Wren only re-reads sources that have changed.

To see when each source was last read:

```
/wren ingest status
```

## Tips for good sources

- **One topic per source.** A channel called `#rules` is much more useful than one called `#general-discussion`. Wren searches by topic; mixed channels confuse it.
- **Pin important messages.** Pinned messages are reliably picked up; older messages can scroll out of Wren's window.
- **Keep your pages short.** Webpages with thousands of words get cut off. Split very long guides across a few pages.
- **Use weights.** Your rules channel should be the highest weight (around `1.5`). Off-topic chatter channels should be `0.5` or lower.

## What's next

If you want Wren to read documents that are too short or weird for a website or channel, see [Letting Wren Read Your Documents](documents.md).
