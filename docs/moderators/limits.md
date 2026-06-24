# What Wren Will Not Do

Wren has hard limits. They're not suggestions. They're guardrails your server owner chose so that nobody — including a hurried moderator — can accidentally nuke the wrong thing.

## Mass actions

Wren will refuse any command that targets more than one player at a time. This includes:

- "Ban everyone."
- "Kick all players."
- "Teleport everyone to me."
- "Message everyone with this text."

If you need to do something to a group of players, do it one player at a time. Wren can still help — just send each command separately, or ask your admin to do it through the dashboard.

The same rule applies to vague targets like "all" and "everyone." Wren reads the word and stops.

## Targeting Wren itself

You can't ban, kick, kill, or message Wren. Wren isn't a player and won't pretend to be one.

## Anything outside your permissions

Every Wren command is gated by your role. If your role doesn't have permission to, say, ban players, Wren will not do it for you — even if you ask nicely. It will respond with something like "permission denied: tool ban_player requires role mod, actor is user."

If you think you should have access and you don't, talk to your server admin. They can update the policy with `/wren policy set`.

## Pretending to know things Wren doesn't

Wren will not invent facts to fill an answer. If you ask "what's the rule on X?" and Wren can't find a rule about X in your sources, Wren will say "I don't know" or "I couldn't find that in your documentation." It will not make something up.

This is a feature, not a bug. It's why your community can trust Wren's answers.

## Acting on messages that aren't addressed to it

Wren only responds when mentioned or replied to. It doesn't lurk in every channel looking for things to react to. If you want Wren to do something, you have to call it.

## Going around the audit log

Every moderator action Wren takes writes a row to your server's audit log. The audit log is append-only and visible to your server owner. Wren can't take an action "off the books."

## What Wren does silently, though

Three things happen in the background without you pinging Wren:

- Wren greets new tickets.
- Wren watches for raid patterns.
- Wren reads new messages when you do ping it.

That's it. Wren is not running analytics on your server. It is not collecting member data. It is not logging channels it isn't asked to read.

## What's next

For the full list of slash commands you can run, see [All /wren Commands](../reference/commands.md).
