# Ticket Autoresponder

Wren includes a powerful **Ticket Autoresponder** built specifically for Pro tier subscribers. This feature allows Wren to automatically greet users in newly created support tickets, ask for consent, and then read the ticket context to provide an immediate AI-driven response.

## How It Works

1. **Category Monitoring:** Wren listens to specific Discord categories designated for support tickets. 
2. **Initial Delay:** When a user creates a new ticket channel in one of these categories, Wren will wait 10 seconds to allow ticketing bots (such as Ticket Tool or TicketsBot) to post their introductory embeds or the user's initial question.
3. **Consent Request:** Wren will post an introductory message asking the ticket opener to accept the Terms of Service and Privacy Policy.
4. **Automatic Response:** Once the user clicks "Agree & Continue," Wren will review the previous messages in the channel and attempt to resolve the issue based on the server's knowledge base and real-time knowledge.

## Security First

Wren is designed to be completely safe when interacting with users:
* **Informational Only:** When operating in the Ticket Autoresponder mode, Wren is locked into the lowest permission level (`user`). It can only use read-only informational tools (like searching knowledge or checking server stats) and is strictly prevented from executing administrative or moderation actions.
* **Consent Driven:** Wren will never process a ticket's content unless the user explicitly agrees to the Terms of Service.

## Enabling the Ticket Autoresponder

You must have an active **Pro Plan** to use this feature.

1. In your Discord server, run the `/wren config` command.
2. Under the **Channels** category, find the **Ticket Categories (Pro)** option.
3. Select up to 10 Discord categories where your support tickets are generated.
4. The autoresponder is now active! Any new channel created inside these categories will trigger Wren.

{% hint style="warning" %}
**Note:** Each automatic response provided by Wren counts towards your server's monthly message quota. 
{% endhint %}
