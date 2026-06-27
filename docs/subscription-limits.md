# Understanding Your Subscription & Limits

Wren offers a powerful suite of AI tools, but running advanced language models and voice transcription requires significant computing resources. To manage this, Wren operates on a tiered subscription system.

This guide explains how limits work, how to check your usage, and what happens when you hit a cap.

---

## Checking Your Usage

Server Owners and Admins can check the server's current usage and subscription status at any time by typing:
```
/wren billing status
```

This will output:
1. Your current Plan Tier (Free, Core, or Pro).
2. The number of messages you have used this month.
3. Your total monthly message limit.
4. When your billing cycle resets.

---

## What Counts as a "Message"?

Your monthly message limit applies to the number of times Wren has to generate an AI response. 

**This includes:**
- Replying to a user who pinged `@Wren`.
- Replying to a user in a support ticket.
- Replying to a user in a Voice Channel.

**This DOES NOT include:**
- Running slash commands (like `/wren config` or `/wren sources list`).
- Background ingestion (when Wren reads your server documentation).
- Moderation actions (like automatically punishing a raider).

---

## Voice Chat Limits

Voice Chat uses a separate resource pool based on **Active Listening Time**.

- **Free Plan:** 2 minutes per month.
- **Core Plan:** 30 minutes per month.
- **Pro Plan:** 120 minutes per month.

**How time is calculated:** 
The timer starts the moment Wren joins the voice channel and hears the wake word ("Hey Wren"). It stops the moment Wren finishes speaking its response. You are only billed for the seconds where Wren is actively transcribing your voice or speaking back to you. Sitting idle in a voice channel does *not* consume your minutes.

---

## What Happens When I Hit My Limit?

If your server reaches its monthly message cap or voice chat limit, Wren will temporarily stop answering queries.

When a user tries to talk to Wren, the bot will politely inform them that the server has reached its AI limits for the month. 

To restore service, the Server Owner can either:
1. Wait for the billing cycle to reset (shown in `/wren billing status`).
2. Upgrade to a higher tier using `/wren billing upgrade`.

*Note: Upgrading is prorated. If you upgrade mid-month, you will only be charged for the remainder of the month, and your new limits will be applied immediately.*
