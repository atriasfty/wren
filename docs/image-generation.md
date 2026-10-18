# Image Generation

Wren can create images for you. Just ask in chat, for example "@Wren draw a police cruiser driving through a snowy Liberty County at night", and Wren will generate it and reply with the image attached.

## How to use it

- Ask Wren to create, draw or generate an image and describe what you want. The more detail (subject, style, lighting, colours), the better.
- You can ask for a shape: **square (1:1)**, **4:3**, **3:4**, **widescreen (16:9)** or **tall (9:16)**. If you don't say, Wren picks one that fits.
- Wren replies in its own voice with the image attached to the message.
- Image generation works in **Discord** only, not in-game chat or voice chat.

## Limits

Image generation is limited **per person**, not per server, over a **rolling 7 days**:

| Plan | Images per person per week |
|---|---|
| Free | None |
| Core | 2 |
| Pro | 10 |

- Each image frees up 7 days after it was made, so it's a rolling window rather than a weekly reset.
- If a generation fails, it isn't counted against you.
- Image generation doesn't use your server's monthly message allowance beyond the normal message Wren spends replying.
- The server's plan decides the allowance, so everyone on a Core server gets 2 and everyone on a Pro server gets 10. Run `/wren upgrade` to change plan.

## Checking your allowance

Ask Wren something like "how many images can I still make?" and it will tell you your plan, how many you've used this week, how many are left, and when your next one frees up.

Moderators (and above) can also ask Wren about another member's allowance by giving their Discord user ID.

## Privacy

Your prompt is sent to OpenRouter, which routes it to the image model (Recraft V4.1 Flash). Wren does not store the generated images; they're attached to the Discord message, which Discord stores like any other. See the [Privacy Policy](privacy-policy.md).
