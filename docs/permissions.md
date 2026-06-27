# Permissions

Wren uses a simple role-based system to control who can use which tools. When someone asks Wren to do something, it checks their Discord roles against the permission level required for that action.

## Setting Up Roles

Before Wren can enforce permissions, you need to tell it which Discord roles in your server correspond to **leadership**, **admin**, and **mod**. Open the configuration panel with `/wren config view`, go to **Channels**, and set:

* **Leadership role** — Set this to the role you give everyone on your highest leadership team. Anyone with this role can use secure commands like managing memory, ingest, and managing bans.
* **Admin role** — Set this to the role you give everyone on your admin team. Anyone with this role can do everything mods can, plus more sensitive actions like banning players. Wren also treats every role **above** the admin role in your server's role hierarchy as admin automatically.
* **Mod role** — Set this to the role you give everyone on your moderation team. Anyone with this role can use everyday moderation tools like kicking players, teleporting, sending private messages, and logging punishments.

You do not need to set up any permission policies manually. Wren comes with sensible defaults the moment you run `/wren setup`.

## How Permissions Work

When someone talks to Wren and asks it to do something, Wren figures out their permission level by checking their Discord roles in this order:

1. **Owner** — bypasses all permission checks.
2. **Leadership role** — access to memory management, ingestion controls, and managing bans.
3. **Admin role** (or Administrator permission) — access to sensitive moderation tools, like banning players.
4. **Mod role** — access to standard moderation tools like kicks, teleports, and private messages.
5. **Everyone else** — basic tools like looking up online players or getting channel logs.

If someone does not have the required role for an action, Wren will politely tell them they do not have permission.

## What Each Level Can Do

### Everyone (no special role needed)
These tools are available to anyone who can talk to Wren:

* Check server stats and player counts
* Look up if a player is online or is staff
* Get player info, Roblox profiles, and activity summaries
* Search command logs
* Browse Discord channels and messages
* Summarize chat
* Check a player's punishment history
* Save personal memories
* Web search

### Mod Role

If someone has the Mod role, Wren will allow them to:
* **Kick a player** — remove a player from the server
* **Kill a player** — instantly kill a player in-game
* **Teleport a player** — move a player to another location or player
* **Send a private message** — send an in-game PM to a specific player
* **Log a punishment** — officially record a warning or kick
* **Get wanted players** — list all currently wanted players and their crimes
* **Get player location** — find the exact coordinates of a player
* **Get a full server briefing** — a complete situational overview including staff positions, wanted players, emergency calls, kills, and queue
* **Get a player profile** — a comprehensive report on a specific player, including their inventory, location, vehicles, team, and recent activity
* **Get active vehicles** — list all spawned vehicles in the server
* **Purge messages** from a Discord channel
* **Save server-wide memories** (facts everyone can see)

### Admin Role

If someone has the Admin role, Wren will allow them to use all Mod tools, plus:
* **Ban a player** — permanently ban a player from the server
* **Promote/Demote** — change a player's in-game staff rank (mod, unmod, admin, unadmin)

### Leadership Role

If someone has the Leadership role, Wren will allow them to use all Admin tools, plus:
* **Add server memory** — explicitly teach Wren new information
* **Remove memory** — delete incorrect or outdated memories
* **Manage bans** — use `/wren bans` to ban or unban users from using Wren
* **Ingest documentation** — trigger manual document ingestion

### Manage Guild
Everything above, plus:

* **Bring all staff** — teleport every online staff member to a specific player
* **PM all staff** — send a private message to every online staff member

These mass-action tools are restricted to people with the Discord **Manage Guild** permission because they affect all staff at once.

## Overriding Defaults

If the default permission levels do not fit your server, you can change them. Use `/wren policy view` to see the current policy, and ask a developer to adjust individual tool policies in the database. Each tool can be set to any level: `user`, `mod`, `admin`, `leadership`, or `owner`.

---

## What if I don't set roles?

If you have not set a **Mod role**, **Admin role**, or **Leadership role** in the config panel, only the server owner and people with the Discord Administrator permission will be able to use moderation tools. Make sure to configure your roles after running `/wren setup`!
