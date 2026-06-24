# Policy Commands

Wren's **policy** is the table that says who can do what. Every action Wren can take is gated by an entry in this table. If there's no entry, the action is denied by default — Wren would rather say "I can't" than do the wrong thing.

## The five ranks

Wren recognises five ranks, in order from most to least powerful:

- **owner** — the Discord server owner.
- **admin** — members with the Administrator permission.
- **mod** — members with one of your staff roles.
- **staff** — members with a lower staff role, if you've set one.
- **user** — everyone else.

When you set a policy row, you're saying "at least this rank can do this thing." Anyone at a higher rank can also do it.

## `/wren policy view`

Shows the full policy table.

```
/wren policy view
```

The default policy on a fresh `/wren setup` looks like:

```
admin_player → admin
ban_player → mod
bring_all_staff → admin
check_if_online → user
check_if_staff → user
check_player_perks → user
check_punishments → user
check_whitelist_status → user
get_all_channels → user
get_channel_messages → user
get_player_info → user
get_server_stats → user
get_user_info → user
kick_player → mod
kill_player → mod
list_online_players → user
log_punishment → mod
lookup_roblox_profile → user
mod_player → admin
pm_all_staff → admin
purge_messages → mod
save_memory_server → mod
save_memory_user → user
search_command_logs → user
send_pm → mod
summarize_chat → user
tp_player → mod
unadmin_player → admin
unmod_player → admin
analyze_player_activity → user
```

## `/wren policy set`

Changes one row.

```
/wren policy set tool:<tool name> min-role:<owner|admin|mod|staff|user>
```

For example, to let mods promote to admin (you almost certainly do not want this — it's an example):

```
/wren policy set tool:admin_player min-role:mod
```

To make the bot never ban anyone (overrides the default mod-allow):

```
/wren policy set tool:ban_player min-role:owner
```

## Common recipes

**Restrictive (mods can only kick and look things up):**

```
/wren policy set tool:ban_player min-role:admin
/wren policy set tool:tp_player min-role:admin
/wren policy set tool:mod_player min-role:owner
/wren policy set tool:admin_player min-role:owner
```

**Open (any staff can do most things):**

```
/wren policy set tool:ban_player min-role:staff
/wren policy set tool:kick_player min-role:staff
/wren policy set tool:kill_player min-role:staff
```

**Read-only server (mods can only look things up):**

```
/wren policy set tool:ban_player min-role:owner
/wren policy set tool:kick_player min-role:owner
/wren policy set tool:kill_player min-role:owner
/wren policy set tool:tp_player min-role:owner
/wren policy set tool:send_pm min-role:owner
/wren policy set tool:mod_player min-role:owner
/wren policy set tool:admin_player min-role:owner
```

## What ranks are not

- Rank is **not** the same as Discord role. Wren figures out your rank by checking whether you have any of the role slots you mapped under `/wren roles set`.
- Rank is **not** saved per user. It's computed every time Wren needs to check a permission.

## What gets denied silently

Nothing. If a moderator tries to do something their rank doesn't allow, Wren replies with a clear "permission denied" message that names the tool, the required rank, and their actual rank. This is intentional — your team should know when the policy stops them, not guess.

## What's next?

[Role Commands](roles.md) — for connecting Discord roles to Wren's rank system.
