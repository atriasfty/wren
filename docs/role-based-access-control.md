# Role-Based Access Control (RBAC) Guide

Wren has a powerful internal permission system that lets you control who can manage the bot, configure settings, or execute sensitive commands.

Instead of relying solely on Discord's native permissions (like "Manage Server"), Wren maps your Discord Roles to internal "Slots".

---

## Permission Levels

Wren recognizes five distinct permission tiers:

1. **Owner:** The user who owns the Discord server. They bypass all role checks and have absolute control.
2. **Leadership:** Can manage the bot's data, such as banning users, adding or deleting server memories, triggering documentation ingestion, and modifying role mappings.
3. **Admin:** Can execute sensitive moderation commands like banning players or modifying staff ranks.
4. **Mod:** Can execute everyday moderation-related commands (like interacting with the ERLC/Roblox integrations).
5. **User:** Regular server members. They can talk to Wren, but cannot use moderation tools or configure the bot.

## How to Map Discord Roles to Wren Slots

You map your existing Discord roles to Wren's permission levels using the `/wren config` command.

### Example Setup

Let's say your Discord server has the following roles: `Server Director`, `Community Manager`, and `Trial Moderator`.

1. **Open the Config Panel:**
   Type `/wren config` in your server to open the configuration panel.

2. **Map the Leadership Role:** 
   Navigate to the **Channels & Roles** category and select the **Leadership role** option. Choose `@Server Director`.
   Now, anyone with the Server Director role can configure Wren's core settings, manage bans, and manage memories.

3. **Map the Admin Role:**
   Select the **Admin role** option and choose `@Community Manager`.
   Community Managers can now ban players and manage staff ranks. 
   *(Note: The Admin tier automatically applies to any role higher in the hierarchy than the mapped Admin role).*

4. **Map the Mod Role:**
   Select the **Mod role** option and choose `@Trial Moderator`.
   Trial Moderators can now use Wren's game integration tools to moderate players.

*(Note: Permissions inherit downward. If you are Leadership, you automatically have Admin and Mod permissions).*

---

## Feature-Specific Permissions

In addition to the global roles above, you can lock specific Wren tools and features to specific permission levels using **Tenant Role Policies**.

For example, if you want to restrict who can use Wren's Voice Chat feature:
1. Ask an Atria Developer to update your policy for the `voice_chat` tool. (Customizing policies currently requires developer assistance or using the database directly via `/wren policy`).
2. Once the policy is set to `mod`, only users with a role mapped to Mod (or higher) can speak to Wren in Voice Channels. Regular users will be ignored.

You can view all current policies by typing `/wren policy view`.
