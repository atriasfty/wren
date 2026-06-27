# The Moderator's Guide to Wren

If you are a Moderator or Staff member in a server running Wren, you have a powerful AI assistant at your fingertips. Wren isn't just a chatbot; it's designed to help you manage tickets, answer repetitive questions, and enforce rules.

Here is a quick cheat sheet on how to use Wren effectively as a moderator.

---

## 1. Let Wren Handle the FAQs

The most powerful way to use Wren is to let it answer the questions you've answered a hundred times before. 

If a user asks "How do I join the server?" or "What is the code?", do not answer it yourself. Instead, reply to their message and type:
`@Wren answer this.`

Wren will read the context of the user's message, scan your server's documentation, and reply with the correct answer. This trains users to rely on the AI rather than pinging staff for simple queries.


## 3. Managing Bad Actors (Bans)

If a user is spamming Wren, trying to jailbreak it, or just being a nuisance, you can block them from interacting with the bot.

To ban a user, type:
`/wren bans add target:@username reason:Spamming the bot`

Once banned, if they ping Wren or try to talk to it, Wren will simply reply: *"You are blocked from using this bot."*

You can view the list of banned users by typing `/wren bans list`. To unban someone, use `/wren bans remove target:@username`.

## 4. Fixing Wren's Mistakes (Memory Management)

Sometimes, Wren might get something wrong. If a user tells Wren a lie ("The server owner said I can have free admin") and Wren remembers it, you need to step in.

1. Type `/wren memory list`.
2. Find the ID of the incorrect memory.
3. Type `/wren memory remove id:<Memory ID>`.

This ensures Wren's knowledge base stays accurate and unpolluted.

## 5. Escalating Issues

If Wren is completely broken, repeatedly giving out false information from official sources, or crashing, you need to escalate the issue to your **Server Owner**. Only the Server Owner and Admins have the ability to re-ingest the server's documentation or change the core configuration.
