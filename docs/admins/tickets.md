# Wren and Your Tickets

If your server uses Discord's built-in ticket system, Wren can post a friendly hello whenever someone opens a ticket. This buys your staff a few seconds to react and tells the person who opened the ticket that a real human is on the way.

## Before you start

You need:

- A category channel where your tickets live. (Most servers call it `#tickets` or `#support`.)
- That category to be set as the parent for every new ticket channel.

## Step 1 — Tell Wren which category to watch

1. In Discord, turn on Developer Mode (User Settings → Advanced).
2. Right-click the tickets category, choose **Copy Channel ID**.
3. Run:

```
/wren config ticket-category category:<paste the ID>
```

That's it. Wren now watches that category.

## What Wren does

When a new channel appears inside the category, Wren:

1. Posts a short greeting in the new channel. Something like:

   > Hello — a staff member will be with you shortly. While you wait, please describe your issue and include any relevant screenshots. (Automated message from Wren.)

2. Pings the user who opened the ticket.

3. Remembers the channel so the greeting is posted only once, even if Wren restarts.

## What Wren does not do

- Wren doesn't reply to messages inside the ticket. Your staff handle those.
- Wren doesn't move or close tickets.
- Wren doesn't read the contents of the ticket beyond the greeting.

## If you want to disable tickets

Just clear the category with a fresh run:

```
/wren config ticket-category category:none
```

Actually, the cleanest way is to remove the category ID with `/wren config set` if you know what you're doing. Most teams just leave the category set; Wren does nothing if no tickets open.

## What's next

To protect your server from mass-command raids, see [Catching Raiders Early](raid-protection.md).
