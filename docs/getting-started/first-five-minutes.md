# Your First Five Minutes

You've just run `/wren setup`. Now let's make Wren useful in five short steps.

## Step 1 — Give Wren your rules

Pick the channel where your rules live. The cleanest setup is a single channel called `#rules` or `#handbook` where everything is pinned.

Copy the channel's ID. In Discord, right-click the channel name, choose **Copy Channel ID**. (If you don't see this option, turn on Developer Mode under User Settings → Advanced.)

Run:

```
/wren sources add kind:channel ref:<paste the ID> label:Rules
```

Wren will reply confirming the source was added. From now on, when you ask Wren a rules question, it will search this channel.

## Step 2 — Add your website (optional)

If your community has a website with guides or a handbook, give Wren the URL:

```
/wren sources add kind:website ref:https://your-site.com/handbook label:Website
```

Wren will pull the text from the page on the next refresh.

## Step 3 — Paste a short document (optional)

For things that don't fit in a channel or a website — a quick FAQ, a list of punishments, the cheat sheet for new mods — paste them in directly. There are two ways to do this:

1. Save the text to a file and use `/wren sources add kind:document ref:faq.txt` after dropping the file in Wren's data folder.
2. Use `/wren config core-info` to add a short block that Wren always sees, even without searching.

For most communities, the **core info** block is the easier route. It's the small, always-on note Wren carries in its head.

## Step 4 — Let Wren read all of this

Type:

```
/wren ingest run
```

Wren will download everything, chop it into small pieces, and store it for searching. The first run takes a couple of minutes. After that, Wren can answer questions immediately.

## Step 5 — Try it

In any channel where Wren has access, write:

```
@Wren What are the rules about vehicles?
```

Wren will reply in a few seconds with a short, plain-English answer drawn from your sources.

## That's it

You're done. The rest of this guide is for when you want Wren to do more — handle tickets, watch for raiders, take in-game actions, or give different moderators different powers.

## Next step

[Setting Up Your Server](../admins/setup.md).
