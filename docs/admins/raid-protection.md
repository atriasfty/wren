# Catching Raiders Early

A raid is when one player starts running commands in your server in a way that's clearly not normal play. Maybe they're spawning vehicles by the dozen. Maybe they're teleporting around the map. Maybe they're announcing slurs in chat. Wren can spot this pattern and act before your staff even notice.

## How the detection works

Every minute, Wren looks at the last 30 seconds of in-game commands. If any single player ran more than 6 commands in that window, Wren flags them as a likely raider.

This is a heuristic. It will miss clever raiders who spread their commands out, and it might catch a legitimate power user who is genuinely running many commands. Tune the thresholds when you need to.

## Step 1 — Pick an alert channel

This is the channel where Wren will post "raid detected" warnings. Pick a staff-only channel so members don't see the alert.

```
/wren config raid-alert channel:#staff-alerts role:@Staff
```

The role is optional. If you set it, Wren will ping the role whenever a raid is detected. Leave the role out if you'd rather not get pinged.

## Step 2 — Decide whether to auto-ban

By default, when Wren spots a raid, it just posts an alert. You can turn on auto-ban so Wren bans the offending player for 60 minutes as soon as the threshold trips.

```
/wren config raid-auto-punish enabled:true
```

To turn auto-ban off later:

```
/wren config raid-auto-punish enabled:false
```

## When you should not turn on auto-ban

- During community events when many players are running commands at once.
- During active testing where developers are stress-testing.
- If your ERLC server is heavily modded and players legitimately run many commands.

When in doubt, leave auto-ban off and use alerts only. You can always upgrade to auto-ban once you're confident the detection isn't false-positiving.

## What gets written down

Every raid detection writes a row to Wren's audit log. If you want to look back at past alerts, ask Wren from inside Discord and the host can pull them for you. Wren's audit log includes the player name, the count, and what action (if any) was taken.

## What's next

Now that Wren knows your server, you might want to give different moderators different powers. See the [Policy Commands](../reference/policy.md) page.
