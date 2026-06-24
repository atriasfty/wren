# Role Commands

Wren needs to know which Discord roles count as "staff" so it can figure out whether someone is a moderator, an admin, or just a regular member. The role commands let you map your Discord roles to Wren's slots.

## What slots exist

There are nine slots Wren recognises:

- **`staff_a`**, **`staff_b`**, **`staff_c`** — your main staff roles. Anyone with one of these is a `mod`.
- **`staff`** — a lower-tier staff role (helpers, trainees). Anyone with this role is `staff` but not `mod`.
- **`whitelist`** — players who are allowed to join the in-game server.
- **`booster`** — Discord server boosters, if you give them perks.
- **`la_plus`**, **`la_premium`** — your community's premium tiers, if you have them.

You don't have to map every slot. Map only the ones that matter to your server.

## `/wren roles view`

Shows your current mappings.

```
/wren roles view
```

If you've set nothing yet, the reply will be "No role slots configured."

## `/wren roles set`

Connects a Discord role to a slot.

```
/wren roles set slot:<slot name> role:<role mention>
```

For example:

```
/wren roles set slot:staff_a role:@Moderator
/wren roles set slot:staff_b role:@Senior Mod
/wren roles set slot:whitelist role:@Whitelisted
```

The role is given by `@mention`, so you can pick it from the picker Discord shows you.

## Why three staff slots?

Most servers have a tier of staff: trial mod, full mod, head mod. Mapping them as `staff_a`, `staff_b`, `staff_c` means Wren treats them all as moderators, but you (the admin) can tell who has what just by looking at the role list.

If you only have one staff role, map it to `staff_a` and leave the others alone.

## Order doesn't matter

Wren checks slots in a fixed order: any of `staff_a/b/c` → `mod`; otherwise `staff` → `staff`; otherwise `user`. The order you set them in doesn't change anything.

## What ranks come out of this

- A user with **`staff_a`**, **`staff_b`**, or **`staff_c`** → rank `mod`.
- A user with **`staff`** but not the others → rank `staff`.
- A user with the server's `Administrator` permission → rank `admin`.
- The Discord server owner → rank `owner`.

If Wren says "permission denied" when a moderator tries something, check `/wren roles view` and make sure they have the right role mapped.

## What's next?

[Ban Commands](bans.md) — for blocking users from using Wren entirely.
