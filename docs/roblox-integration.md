# Roblox Integration

Wren is not stuck in Discord. It can actually join you in your favorite Roblox games, like Emergency Response: Liberty County (ERLC)!

## How it works

Wren connects directly to the game's Private Message (PM) system. This means you can open up your chat box in the game, send a message to Wren, and get a reply right there on your screen!

### Multi-Turn Conversations

We didn't just want Wren to be a simple command bot. We wanted it to feel like a real companion. That is why Wren supports multi-turn conversations in game.

If you ask Wren a question, and then ask a follow up question, Wren remembers the context! It remembers what you were talking about for up to 5 minutes after your last message. 

{% hint style="success" %}
This makes it super easy to get help or just have a fun chat without leaving your game.
{% endhint %}

### ERLC Integration

Wren is specifically integrated with Emergency Response: Liberty County! To start talking to Wren in the game, all you have to do is open your chat and type `:pm wren` followed by your message. Wren will immediately receive it and reply to you!

### In-Game Server Insights

Wren provides deep server insights directly in Discord. Without leaving your chat, you can:
* **Track Vehicles:** View a live list of all spawned vehicles, including their owners, plates, and liveries to catch griefers.
* **Locate Players:** Get the exact street address, postal code, and coordinates of any online player.
* **Monitor Wanted Levels:** Instantly pull a list of all players who currently have wanted stars.

## Configuration

To set up the Roblox integration, server administrators can use the `/wren config view` command to open the configuration panel.
* **Identity:** Set the "In-game PM handle" (like `:pm wren`) so players know how to reach Wren.
* **Channels:** Set the "ERLC log channel" to choose where Wren should post logs from the game.
* **Secrets:** Securely enter your "ERLC server key" to allow Wren to connect to your specific server.

{% hint style="warning" %}
⚠️ **IMPORTANT:** You must whitelist Wren's IP (`152.53.21.47`) in your ERLC server dashboard (https://api.erlc.gg/server-owners), otherwise Wren won't be able to connect or perform any actions.
{% endhint %}
