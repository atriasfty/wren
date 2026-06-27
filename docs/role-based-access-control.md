# Role-Based Access Control (RBAC) Guide

Wren has a powerful internal permission system that lets you control who can manage the bot, configure settings, or execute sensitive commands.

Instead of relying solely on Discord's native permissions (like "Manage Server"), Wren maps your Discord Roles to internal "Slots".

---

## Permission Levels

Wren recognizes five distinct permission tiers:

1. **Owner:** The user who owns the Discord server. They bypass all role checks and have absolute control.
2. **Admin:** Can manage all Wren configurations, add/remove sources, manage billing, and modify role mappings.
3. **Staff:** Can manage the bot's data, such as banning users, deleting memories, or checking audit logs.
4. **Mod:** Can execute moderation-related commands (like interacting with the ERLC/Roblox integrations).
5. **User:** Regular server members. They can talk to Wren, but cannot configure the bot.

## How to Map Discord Roles to Wren Slots

You map your existing Discord roles to Wren's permission levels using the `/wren roles` command.

### Example Setup

Let's say your Discord server has the following roles: `Server Director`, `Community Manager`, and `Trial Moderator`.

1. **Map the Admin Role:** 
   `/wren roles set slot:admin role:@Server Director`
   Now, anyone with the Server Director role can configure Wren's core settings.

2. **Map the Staff Role:**
   `/wren roles set slot:staff role:@Community Manager`
   Community Managers can now manage Wren's memory and ban lists.

3. **Map the Mod Role:**
   `/wren roles set slot:mod role:@Trial Moderator`
   Trial Moderators can now use Wren's game integration tools to moderate players.

*(Note: Permissions inherit downward. If you are an Admin, you automatically have Staff and Mod permissions).*

---

## Feature-Specific Permissions

In addition to the global roles above, you can lock specific Wren tools and features to specific permission levels using **Tenant Role Policies**.

For example, if you want to restrict who can use Wren's Voice Chat feature:
1. Type `/wren policy set tool:voice_chat min_role:staff`
2. Now, only users with a role mapped to Staff (or higher) can speak to Wren in Voice Channels. Regular users will be ignored.

You can view all current policies by typing `/wren policy list`.
