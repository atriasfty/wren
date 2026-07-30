# Security & Data Privacy Overview

We understand that inviting an AI bot into your community requires an immense amount of trust. Wren is built from the ground up with security and data privacy as core architectural pillars. 

This guide provides a plain-English overview of how we handle your data. For full legal details, please read our [Privacy Policy](privacy-policy.md).

---

## Data Processing Agreement (DPA)

When Wren answers a question, it sends your message to our AI model providers via our routing partner, OpenRouter.

**We have a signed Data Processing Agreement (DPA) in place governing this processing.**
Your prompts are never used to train AI models. AI providers may temporarily log prompts (e.g. for abuse monitoring or debugging on their end), subject to the terms of our DPA with them.

## What Do We Actually Store?

To make Wren function, we store the following data on our own secure, self-hosted servers:

1. **Server Configuration:** Your settings, API keys, and role mappings.
2. **Sources:** The text of the documents and websites you explicitly tell Wren to read.
3. **Memories:** The facts Wren learns about your community (viewable and deletable via `/wren memory list`).
4. **Audit Logs:** A record of who ran administrative commands.
5. **Observability Logs (30 Days):** We temporarily log the exact prompts and responses Wren generates into an EU-hosted analytics platform (PostHog). This helps us debug crashes and monitor for abuse. These logs are automatically and permanently deleted after 30 days.

## Voice Chat Privacy

**Wren does not record your voice.** 
When Wren is in a Voice Channel, it uses a local, on-device Wake Word engine to listen for "Hey Wren." Until you say the wake word, no audio ever leaves your Discord server. 

Once you say the wake word, your speech is temporarily streamed to a transcription service to turn it into text. The audio file is never saved to a database, and we do not keep recordings of your conversations.

## Encryption & Security

- **API Keys & Secrets:** If you provide Wren with a Roblox ERLC Server Key or a POW API token, we encrypt it at rest using AES-256-GCM. Even if our database was completely compromised, the attackers could not read your API keys.
- **MCP Tokens:** Web dashboard and API tokens are stored as one-way bcrypt hashes. We cannot see your tokens.

## Right to Erasure (GDPR)

If you wish to have all of your personal data scrubbed from our systems, you can request a GDPR wipe. 
When requested, our privacy tools will permanently delete your AI memories, Terms of Service agreements, API tokens, and audit logs.

*Note: For community safety and fraud prevention, we do not delete ban records. If you were banned from using Wren, that record will be retained indefinitely.*
