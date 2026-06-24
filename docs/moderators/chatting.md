# Talking to Wren

Wren only listens when you ping it. It does not read every message in your server.

## How to get Wren's attention

In any channel where Wren is allowed to send messages, type `@Wren` followed by your question. Like this:

```
@Wren What is the punishment for mass RDM?
```

You can also reply to one of Wren's messages. Just hit Reply, type your question, and send. Wren will know you're talking to it because of the reply context, even without the ping.

## The kind of questions Wren answers well

- **Rules and policies** — anything that's in your sources.
- **Player lookups** — "is X online?", "is X staff?", "what permissions does X have?"
- **Recent activity** — "what has X been doing recently?", "show me the last 5 commands by X."
- **Quick mod actions** — "ban X for 1 day, RDM", "kick X, spamming".
- **Meta** — "how many players are online?", "is the server up?"

## The kind of questions Wren handles gracefully

- **Out-of-scope questions.** If you ask Wren "what's the meaning of life?" it will say so rather than inventing something.
- **Questions with no source.** If the answer isn't anywhere in your sources and Wren can't find it on the web either, it will tell you it doesn't know.

## The kind of questions Wren refuses

- **Mass actions.** "Ban everyone," "kick all," "tp everyone to me." Wren will refuse and tell you to do them one at a time.
- **Actions against itself.** "Ban Wren." (You can't. Wren isn't a player.)
- **Anything the policy doesn't allow.** If your role isn't allowed to ban players, Wren will tell you.

## How long Wren takes

Most replies arrive in 2 to 6 seconds. The first message after a server restart can take a bit longer because Wren has to warm up its search index. After that, it's quick.

If Wren doesn't reply within 15 seconds, check that it didn't say something like "this server is not configured with Wren yet" — that means your admin hasn't run `/wren setup` yet.

## Multi-message replies

If Wren's answer is long, it will split it into multiple messages. You'll see them arrive one after another. Nothing to do — just read.

## Tips for great questions

- **Be specific.** "What's the rule about failing to roleplay?" beats "tell me about RP."
- **Name the player.** "Has CoolPlayer123 been banned?" beats "has this person been banned?"
- **Use keywords from your rules.** If your rules say "no metagaming," ask "what's the rule on metagaming?" Wren will find the exact section.
- **Tell Wren when to act.** "Ban X for 1 day, RDM in the city" tells Wren what to do and why. Just asking "ban X" will work, but Wren may ask you to confirm the reason.

## What's next

For looking up specific players, see [Asking About Players](looking-up-players.md).
