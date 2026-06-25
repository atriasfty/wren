# Permissions

Wren uses a simple role-based system to control who can use which tools. When someone asks Wren to do something, it checks their Discord roles against the permission level required for that action.

## Setting Up Roles

Before Wren can enforce permissions, you need to tell it which Discord roles in your server correspond to **staff** and **admin**. Open the configuration panel with `/wren config view`, go to **Channels**, and set:

* **Staff role** — Set this to the role you give everyone on your staff team. Anyone with this role can use everyday moderation tools like kicking players, teleporting, sending private messages, and logging punishments.
* **Admin role** — Set this to the role you give everyone on your admin team. Anyone with this role can do everything staff can, plus more sensitive actions like banning players, promoting and demoting moderators, and promoting and demoting administrators. Wren also treats every role **above** the admin role in your server's role hierarchy as admin automatically, so you only need to set this to your lowest admin rank and everyone above it is covered.

You do not need to set up any permission policies manually. Wren comes with sensible defaults the moment you run `/wren setup`.

## How Permissions Work

When someone talks to Wren and asks it to do something, Wren figures out their permission level by checking their Discord roles in this order:

1. **Server owner** or anyone with the **Manage Guild** permission — full access to everything, including mass-action tools.
2. **Administrator** permission, the configured **Admin role**, or any role **above** the admin role in the server's role hierarchy — access to all moderation tools, including bans and rank changes.
3. **Staff role** — access to standard moderation tools like kicks, teleports, and private messages.
4. **Everyone else** — can chat with Wren and use read-only tools like checking server stats, looking up players, and searching the web.

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

### Staff Role
Everything above, plus:

* **View spawned vehicles** and their owners
* **Find player locations** (street address and coordinates)
* **Monitor wanted players** and their star levels
* **Get a full server briefing** — a complete situational overview including staff positions, wanted players, emergency calls, kills, and queue
* **Profile a player** — a comprehensive background check combining in-game data, Roblox account info, vehicles, kill history, and punishment records
* **Kick** a player from the ERLC server
* **Kill** a player in-game
* **Teleport** one player to another
* **Send a private message** to a player in-game
* **Purge messages** from a Discord channel
* **Log a punishment** to POW
* **Save server-wide memories** (facts everyone can see)

### Admin Role
Everything above, plus:

* **Ban** a player from the ERLC server
* **Promote** a player to Server Moderator
* **Demote** a Server Moderator
* **Promote** a player to Server Administrator
* **Demote** a Server Administrator

### Manage Guild
Everything above, plus:

* **Bring all staff** — teleport every online staff member to a specific player
* **PM all staff** — send a private message to every online staff member

These mass-action tools are restricted to people with the Discord **Manage Guild** permission because they affect all staff at once.

## Overriding Defaults

If the default permission levels do not fit your server, you can change them. Use `/wren policy view` to see the current policy, and ask a developer to adjust individual tool policies in the database. Each tool can be set to any level: `user`, `staff`, `mod`, `admin`, or `owner`.

{% hint style="warning" %}
If you have not set a **Staff role** or **Admin role** in the config panel, only the server owner and people with the Discord Administrator permission will be able to use moderation tools. Make sure to configure your roles after running `/wren setup`!
{% endhint %}
