# Something Not Working?

A practical guide to debugging the common problems, in the order you should check them.

## Step 1 — Is Wren online?

Open your Discord server. Look at the member list on the right. If Wren has a green dot, it's online. If it has a grey dot or no dot, it's offline — only your Wren host can bring it back.

If Wren is online but won't reply to your `@Wren`, jump to step 3.

## Step 2 — Is the channel allowed?

Wren only reads and replies in channels it's been invited to. If you mention Wren in a private channel it can't see, nothing will happen.

In your server settings, check the channel's permission overrides for Wren. It needs at least **View Channel**, **Read Message History**, and **Send Messages**.

## Step 3 — Did you run setup?

Type `@Wren` in any channel where Wren can read. If Wren replies with "this server is not configured with Wren yet," the fix is:

```
/wren setup
```

Run that as the server owner and try again.

## Step 4 — Are your sources fresh?

If Wren's answers feel out of date, your sources might be. Run:

```
/wren ingest run
```

This re-reads everything Wren knows about. Wait for the reply before testing again.

## Step 5 — Are permissions correct?

If a moderator gets "permission denied," check two things.

First, is their role mapped in `/wren roles view`? If their role isn't listed, Wren doesn't know they count as staff.

Second, is the tool allowed for their rank in `/wren policy view`? If the tool says `mod` and they're not a mod, they'll be denied.

## Step 6 — Is the ERLC key valid?

If Wren says "tenant has no ERLC server key configured," your admin hasn't added it yet. Run:

```
/wren config erlc server-key:<your key here>
```

The key is found in the PRC dashboard.

## Step 7 — Is the database reachable?

If everything else looks right but Wren just won't respond, the database might be down. This is a host problem, not a server problem. Contact your Wren host.

## Common error messages

**"this server is not configured with Wren yet"**

Run `/wren setup`.

**"permission denied: tool X requires role Y, actor is Z"**

The moderator's rank is too low. Check the policy table.

**"could not find Roblox user: X"**

Wren couldn't match the username to a Roblox account. Check spelling.

**"tenant has no ERLC server key configured"**

Run `/wren config erlc server-key:<your key>`.

**"tenant has no POW token configured"**

Run `/wren config pow token:<your token>`.

**"Discord guild context required"**

Wren was asked a Discord question from outside a guild context. If you're seeing this from inside Discord, report it to your host — it's a bug.

## Still stuck?

If none of the above resolves your issue, get in touch with your Wren host. They have access to the server logs and can usually pinpoint the problem in minutes. When you write, include:

- Your Discord server ID.
- The exact command or message you sent.
- The exact reply you got.
- The time it happened (with timezone).

That information cuts the back-and-forth to a single round-trip.

## See also

- [Glossary](glossary.md) for any terms that didn't make sense.
- [Frequently Asked Questions](faq.md) for more.
