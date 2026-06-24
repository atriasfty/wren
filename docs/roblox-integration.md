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

## Configuration

To set up the Roblox integration, server administrators can use the `/wren config view` command to open the configuration panel.
* **Identity:** Set the "In-game PM handle" (like `:pm wren`) so players know how to reach Wren.
* **Channels:** Set the "ERLC log channel" to choose where Wren should post logs from the game.
* **Secrets:** Securely enter your "ERLC server key" to allow Wren to connect to your specific server.
