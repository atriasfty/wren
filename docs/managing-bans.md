# Managing Bans & Blocked Users

Wren is designed to be a helpful assistant, but sometimes users abuse the bot by spamming it, asking inappropriate questions, or attempting to "jailbreak" the AI to make it say harmful things.

To protect your server's AI token limits and maintain a clean environment, you can block specific users from interacting with Wren.

---

## How to Ban a User

To ban a user, you must have the **Staff** role permission (or higher) mapped in Wren's Role-Based Access Control.

Type the following command in any channel:
```
/wren bans add target:@username reason:Spamming the AI with nonsense
```

**What happens when a user is banned?**
1. Wren will immediately stop answering their questions.
2. If the user explicitly pings or replies to Wren, the bot will respond with a generic error: *"You are blocked from using this bot."*
3. If the user tries to talk to Wren in a Voice Channel, Wren will ignore them entirely.

## Viewing the Ban List

To see a list of everyone who is currently blocked from using Wren in your server, type:
```
/wren bans list
```
This will output a list of Discord IDs, the reason for the ban, and the Staff member who issued the ban.

## Unbanning a User

If you want to restore a user's access to Wren, you can remove the ban by typing:
```
/wren bans remove target:@username
```
The user will immediately be able to interact with the bot again.

---

## Global Bans vs. Server Bans

It is important to note the difference between a **Server Ban** (tenant ban) and a **Global Ban**.

- **Server Bans:** These are the bans you manage using the commands above. They only apply to *your* specific Discord server. The user can still use Wren in other servers.
- **Global Bans:** These are issued for severe violations of the global Terms of Service (e.g., generating illegal content). A Global Ban prevents the user from using Wren *everywhere*. You cannot lift a Global Ban; the user must appeal directly to [support](contact-support.md).
