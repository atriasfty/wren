# Configuration Guide

Wren is highly customizable! Server administrators can configure how Wren behaves, what it knows, and how it interacts with users directly from Discord.

There are no confusing text files to edit. Everything is managed through simple, built-in slash commands!

## The Configuration Panel

To change Wren's core settings, just type `/wren config view` in any channel. This will open up an interactive menu with four main categories:

### 1. Identity
This is how Wren presents itself in your community.
* **Server display name:** The friendly name of your server.
* **Bot display name:** You can rename Wren to fit your server's theme!
* **In-game PM handle:** The handle Wren uses when replying to players in Roblox games like ERLC.

### 2. Channels & Roles
Tell Wren where it is allowed to operate and who is in charge.
* **Status channel:** Where Wren posts important updates.
* **ERLC log channel:** Where Wren sends logs from in-game events.
* **Leadership role:** The role required to access secure Wren commands, like memory, ingest, and bans.
* **Admin role:** Set this to the role you give everyone on your admin team. Members with this role can use sensitive tools like banning players. Every role above the admin role in your server's role hierarchy is automatically treated as admin too, so you only need to set the lowest admin rank.
* **Mod role:** Set this to the role you give everyone on your moderation team. Members with this role can use everyday moderation tools like kicking, teleporting, and messaging players. See the [Permissions](permissions.md) page for the full list.

### 3. Behaviour
This is the most powerful setting! 
* **Core info:** This is an "always-on" note for Wren. You can tell Wren about your server's vibe, the timezone, or who to ping in an emergency. Wren will *always* keep this information in mind when talking to people.

### 4. Secrets
If you are connecting Wren to external services, you can securely store the keys here.
* **ERLC server key:** Required to connect Wren to your Emergency Response: Liberty County server.
* **POW token:** Required if you use POW integrations.

{% hint style="warning" %}
⚠️ **IMPORTANT:** You must whitelist Wren's IP (`152.53.21.47`) in your ERLC server dashboard (https://api.erlc.gg/server-owners), otherwise Wren won't be able to connect or perform any actions.
{% endhint %}

{% hint style="info" %}
All secrets are heavily encrypted in our database. We take your security very seriously!
{% endhint %}

## Other Configuration Commands

Wren has several other commands to help you manage its knowledge and user access:

* `/wren sources list` or `/wren sources add`: Manage where Wren gets its Real-Time Knowledge from. You can add Discord channels, websites, or documents for Wren to read and learn from!
* `/wren memory list`: View and manage the long-term memories Wren has saved about your server or users.
* `/wren bans add`: Prevent specific users from talking to Wren if they are abusing the system.
