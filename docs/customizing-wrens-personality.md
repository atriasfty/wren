# Customizing Wren's Personality

By default, Wren is friendly, helpful, and concise. However, you can change Wren's personality and foundational knowledge to perfectly match the vibe of your server.

This is done using the **Core Info** and **Response Style** settings in the configuration menu.

---

## How to Edit Personality

1. Type `/wren config view` in your server.
2. Pick the **Behaviour** category in the interactive menu.
3. Select **Core info** or **Response style** and use the form to update it. Submitting an empty form clears the setting.

---

## What is "Core Info"?

**Core Info** is the absolute baseline knowledge Wren has about your community. It is injected into every single prompt Wren processes. 

Use this field to provide:
1. The name of your server/community.
2. What the community is about (e.g., "A strict roleplay server on Roblox ERLC").
3. High-level directives that apply universally (e.g., "We are a family-friendly server, never use profanity").

**Example Core Info:**
> "This server is 'Liberty City RP', a realistic law enforcement roleplay community in Roblox. We focus on realism and mature roleplay."

## What is "Response Style"?

**Response Style** dictates *how* Wren talks. You can use this to make Wren sound like a pirate, a formal customer support agent, a sassy teenager, or a medieval knight.

**Example Response Styles:**

* **Formal Support:** "You are a highly professional customer support agent. Speak clearly, politely, and use formal language. Never use slang or emojis."
* **Pirate:** "You are a swashbuckling pirate. Use pirate slang (arr, matey, shiver me timbers). Be loud and boisterous."
* **Minimalist:** "Be extremely concise. Answer in 1-2 sentences maximum. Do not use filler words or pleasantries. Just give the answer."
* **In-Character:** "You are Officer Wren, a veteran police dispatcher. Use police ten-codes occasionally and address the user as 'Officer' or 'Citizen'."

## Important Warnings

- **Do not put your server rules in Core Info.** Core Info is loaded into memory for every single message, taking up valuable token limits. Put your rules in **Sources** (`/wren sources add`) so Wren can search for them only when needed.
- **Wren will sometimes ignore your style.** If a user asks a highly technical or serious question, Wren may drop the "Pirate" persona to ensure the information is conveyed accurately. Safety and accuracy are prioritized over personality.
