# Troubleshooting & Error Messages

If Wren isn't behaving as expected, or if it replies with a specific error message, this guide will help you understand what's wrong and how to fix it.

---

## Common Error Messages

Below is a list of the exact error messages Wren might output and how to resolve them:

### `"⚠️ This server is not configured with Wren yet. An admin must run /wren setup first."`
**What it means:** Wren has been invited to your server, but hasn't been initialized. Wren requires an underlying database record to store your settings, memories, and bans.
**How to fix:** Have the Server Owner or an Administrator type `/wren setup` in any channel. 

### `"You need ManageGuild permission for this."`
**What it means:** You tried to run a configuration command (like `/wren config` or `/wren bans`), but your Discord role lacks the `Manage Server` (ManageGuild) permission.
**How to fix:** Ask the Server Owner to grant your role the "Manage Server" permission in Discord's server settings.

### `"Only the server owner can run ingestion."`
**What it means:** You tried to force Wren to re-read your server's documentation using `/wren ingest status`, but this command places a heavy load on the system and is restricted.
**How to fix:** Ask the user with the crown icon (the Discord Server Owner) to run the command instead.

### `"You are blocked from using this bot."`
**What it means:** Your Discord account has been banned from interacting with Wren. This can happen at the server level (if a server admin ran `/wren bans add target:@you`) or at the global level (if you violated Atria's Terms of Service).
**How to fix:** If you believe this was an error, contact your server administrators. If they confirm you are not banned locally, you may have been globally banned for a Terms of Service violation.

### `"Wren is currently undergoing maintenance and is paused globally. Please try again later."`
**What it means:** The bot has been temporarily paused across all servers to push an update, fix a critical bug, or handle a database migration.
**How to fix:** Just wait! Maintenance usually lasts less than 15 minutes. 


### `"Only the server owner can add server-scoped memory."`
**What it means:** You tried to use `/wren memory add scope:server`. Server-scoped memories apply to *everyone* in the server permanently, so they are highly restricted.
**How to fix:** Ask the server owner to add the memory, or use `scope:user` to save the memory just for yourself.

---

## Voice Chat Issues

### Wren leaves the voice channel immediately or doesn't answer
- **Check your plan limits:** The Free plan includes 2 minutes of active listening time. The Core plan includes 30 minutes, and the Pro plan includes 120 minutes. If you exceed this limit, Wren will refuse to process voice queries. 
- **Check the wake word:** Make sure you clearly say **"Hey Wren"** before asking your question. 
- **Audio permissions:** Ensure Wren has the "Speak" and "Connect" permissions in that specific voice channel.

## AI Hallucinations

If Wren is giving you incorrect information about your server rules, role requirements, or game mechanics:
1. **Check your Sources:** Use `/wren sources list` to ensure your documentation links aren't dead.
2. **Re-ingest data:** Ask the server owner to run an ingestion sync to force Wren to read the newest versions of your rules.
3. **Check Memories:** Use `/wren memory list` to see if someone accidentally added a false fact to Wren's permanent memory. Use `/wren memory remove` to delete it.
