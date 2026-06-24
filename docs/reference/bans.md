# Ban Commands

Wren has its own ban list, separate from the in-game ban list. Putting someone on this list stops them from talking to Wren — they can still see the bot in the member list, but Wren won't reply to them, won't read their messages, won't run their commands.

## When to use this

- A user is spamming Wren with questions or commands.
- A user is trying to abuse Wren to look up information they shouldn't see.
- A banned user keeps creating alt accounts. (This only catches Discord-side alts; it won't help with in-game alt accounts.)

For in-game bans, use the in-game tools or `/wren policy` to make sure Wren can't take the action.

## `/wren bans list`

Shows every banned user on this server.

```
/wren bans list
```

Each row shows the user key, the reason (if any), and who added the ban.

## `/wren bans add`

Puts a user on the ban list.

```
/wren bans add target:@username reason:<why>
```

You must pick a user from Discord's user picker. The `reason` is optional but recommended — your future self will thank you.

```
/wren bans add target:@griefer reason:Spamming Wren with bogus ban requests
```

## `/wren bans remove`

Takes a user off the ban list.

```
/wren bans remove target:@username
```

After this, Wren will respond to them again immediately.

## What happens to a banned user

- They can't make Wren reply.
- They can't run `/wren` commands.
- They can still see Wren in the channel; they just won't get a response.
- If they ask another (non-banned) user to type something on Wren's behalf, Wren will answer — the ban is on the user, not the question.

## What doesn't happen

- The user is not kicked from the Discord server.
- The user is not banned in-game.
- The user is not blocked from reading channels they already have access to.

Wren's ban list is about Wren's behaviour, not the broader server. Use Discord's own ban features for the rest.

## What's next?

[Memory Commands](memory.md) — for storing facts Wren should remember across conversations.
