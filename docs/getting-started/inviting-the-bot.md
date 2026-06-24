# Inviting Wren to Your Server

This is the part where you put Wren inside your Discord. You only do it once per server.

## Step 1 — Get an invite link

Your server host will give you a special invite link for Wren. It looks something like:

```
https://discord.com/oauth2/authorize?client_id=...&scope=bot+applications.commands
```

Open it in your browser. Discord will ask you to pick a server.

## Step 2 — Pick the right server

You'll see a dropdown listing every server where you have Manage Server or Admin. Choose the one you want Wren in. If you don't see it, you don't have permission — ask the server owner.

## Step 3 — Approve the permissions

Discord will show a long list of things Wren is asking to do. You don't have to understand every line, but here's what each cluster means:

- **View channels, send messages, read message history** — Wren needs to see channels to read them and to reply when you mention it.
- **Manage messages** — only used for the "purge" command (delete recent messages from a channel).
- **Manage roles** — used to check whether a member has your staff role.
- **Use slash commands** — required for `/wren` to work.

Click **Authorize**. Discord will ask you to solve a quick captcha to prove you're human.

## Step 4 — Verify Wren is there

Switch to your server. Look at the member list on the right. You should see Wren sitting at the top with an "online" green dot and the name "Wren" (or whatever your host set).

If you don't see Wren, refresh the page. Sometimes Discord lags a few seconds.

## Step 5 — Tell Wren it's allowed

Wren doesn't assume it has permission to run anywhere it appears. You have to opt in. Type this in any channel:

```
/wren setup
```

Wren will reply with a short confirmation. From this moment, Wren recognises your server and remembers all the settings you give it.

## What if I want to remove Wren?

Kick Wren from the server the way you'd kick any other member. All your settings stay in case you invite Wren back, but Wren can no longer read anything until you run `/wren setup` again.

## Next step

[Your First Five Minutes](first-five-minutes.md).
