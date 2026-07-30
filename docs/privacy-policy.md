# Privacy Policy

**Effective Date:** 25 June 2026  
**Last Updated:** 31 July 2026

---

Atria ("we", "us", "our") is a fiscally sponsored project of The Hack Foundation (d/b/a Hack Club), a 501(c)(3) nonprofit. This Privacy Policy explains how Wren, our Discord AI assistant ("the Service" or "Wren"), collects, uses, shares, and retains data about you, and what rights you have over that data.

We take your privacy seriously. If you have questions, please contact us at any time.

---

## 1. Who We Are

| | |
|---|---|
| **Data Controller** | Atria, a fiscally sponsored project of The Hack Foundation |
| **General Contact** | [gdpr@atriasafety.org](mailto:gdpr@atriasafety.org) |
| **Data Protection Officer (DPO)** | [dpo@atriasafety.org](mailto:dpo@atriasafety.org) |

---

## 2. Scope

This policy applies to all users who interact with Wren in any Discord server where it has been installed, as well as Discord server administrators ("Server Owners") who configure and operate the bot within their communities, and any users who access Wren's REST API.

---

## 3. Legal Basis for Processing (GDPR Article 6)

We process your personal data on the following lawful bases:

| Legal Basis | When It Applies |
|---|---|
| **Contractual necessity (Art. 6(1)(b))** | Processing required to provide the Service — e.g., routing your message to the AI model, storing conversation memory. |
| **Legitimate interests (Art. 6(1)(f))** | Fraud prevention, rate limiting, abuse detection, security auditing. |
| **Legal obligation (Art. 6(1)(c))** | Compliance with applicable laws, including data retention obligations. |
| **Consent (Art. 6(1)(a))** | Where we explicitly ask — e.g., when a Server Owner enables optional analytics. |

---

## 4. Data We Collect

### 4.1 Data Collected from Discord Users (End Users)

When you send a message to Wren in a Discord server, we process:

| Data | Purpose | Stored? |
|---|---|---|
| **Your Discord User ID** | Identifies you for memory, bans, and role-based access control | Yes — our database |
| **Your Discord username and display name / nickname** | Captured at the time of interaction for audit logs and memory context | Yes — our database (in memory and audit log entries) |
| **Your message content** | Passed to the AI model to generate a response; logged for observability | **Yes** — transmitted to OpenRouter under a signed Data Processing Agreement (not used to train AI models; may be temporarily logged by AI providers) and stored in PostHog (EU servers) for **30 days**; may also be stored indefinitely as conversation memory if a Server Owner has saved it via Wren's memory system |
| **Recent channel messages** (up to 100 messages) | Provides conversational context to the AI | **Yes** — transmitted to OpenRouter under a signed Data Processing Agreement (not used to train AI models; may be temporarily logged by AI providers) and stored in PostHog (EU servers) for **30 days**; not otherwise persisted in our own database |
| **Images you attach** | Passed by URL to the AI model for vision analysis | No — URLs only; images are not stored by us |
| **Your in-game username / handle** (ERLC integration, if enabled) | Identifies you in game server moderation tools | Yes — stored as plain text in our database; only if your server uses the ERLC integration |

### 4.2 Data Collected from Server Owners / Administrators

When a Server Owner sets up Wren, we collect and store:

| Data | Purpose |
|---|---|
| **Discord Guild (Server) ID** | Primary key for all tenant configuration |
| **Discord Role IDs & Channel IDs** | Configuration for permissions and notifications |
| **Your Discord User ID** | Recorded as the server owner |
| **ERLC Server Key** (if provided) | Stored **encrypted at rest** using AES-256-GCM |
| **POW API Token** (if provided) | Stored **encrypted at rest** using AES-256-GCM |
| **Custom knowledge base content** | Powers the RAG (retrieval-augmented generation) system for server-specific answers |
| **Subscription information** | Your billing tier, Polar.sh customer ID, subscription ID, and the Discord User ID of the purchaser |

### 4.3 Billing Data (Paid Plans Only)

If you purchase a Core or Pro plan via Polar.sh, we store:

- Your **Discord User ID** (linked to the purchase as the subscription owner)
- Your **Polar.sh Customer ID** and **Subscription ID**
- Your **subscription tier** and **monthly message usage count**

Payment card details and full billing address are handled exclusively by **Polar.sh** and their payment processor. We never see or store your raw payment information.

### 4.4 Audit & Operational Logs

We maintain an **audit log** of actions performed within each server (e.g., bans, configuration changes). This log contains:

- Actor (Discord User ID or system identifier)
- Action taken
- Target (if applicable)
- Timestamp

This log is stored only in our database and is not shared externally.

### 4.5 API Access Tokens

If a Server Owner creates an API token for programmatic access, we store a **one-way hash** (bcrypt) of the token. The raw token is shown only once at creation and is never stored or recoverable by us.

---

## 5. Data We Do NOT Collect

- We do not collect your email address or any Discord profile information beyond your numeric User ID, username, and server nickname (which are captured only at the time of interaction, as described above).
- We do not record or log voice channel activity.
- We do not run advertising or sell data to third parties.
- We do not build individual advertising profiles.
- We do not store your payment card details or billing address (these are handled exclusively by Polar.sh).

---

## 6. Discord as a Platform

Because Wren operates entirely within Discord, **Discord Inc. independently processes all data transmitted through their platform** — including your messages, user IDs, and server information — in accordance with [Discord's Privacy Policy](https://discord.com/privacy). Atria does not control Discord's data practices. By using Wren, you also remain subject to Discord's own terms and privacy policy.

---

## 7. Third-Party Services We Use

Your data may be transmitted to the following third-party processors in order to operate the Service:

| Service | Purpose | Data Transmitted | Privacy Policy |
|---|---|---|---|
| **OpenRouter.ai** | Routes requests to AI language models | Your message content, up to 100 recent channel messages, conversation history, system prompt. **We have a signed Data Processing Agreement with OpenRouter. No customer prompts are used to train AI models; prompts may be temporarily logged by AI providers.** | [openrouter.ai/privacy](https://openrouter.ai/privacy) |
| **AI Model Providers** (via OpenRouter) | Generates responses | Same as above — OpenRouter forwards this to the underlying model provider under the terms of our Data Processing Agreement | Varies by model selected |
| **Brave Search** | Web search tool available to Wren | Your query/question (truncated to 300 characters) | [api.search.brave.com/app/trust-center](https://api.search.brave.com/app/trust-center) |
| **Polar.sh** | Subscription billing and payment processing | Discord User ID (as `externalCustomerId`), guild ID (in subscription metadata), subscription tier | [polar.sh/privacy](https://polar.sh/privacy) |
| **PostgreSQL (self-hosted)** | Primary database | All data described in Section 4 above | N/A — operated by us |
| **PostHog** (EU data residency) | Observability, tracing, and prompt/response logging | AI model name, token usage counts, Discord User ID, username, Guild ID, **full message prompts and AI responses** (including recent channel context). Retained for **30 days**. | [posthog.com/privacy](https://posthog.com/privacy) |

> **Note:** When OpenRouter transmits your message to an AI model provider, it is subject to that provider's data policies. OpenRouter's default agreements with model providers prohibit using API data to train models. See [openrouter.ai/privacy](https://openrouter.ai/privacy) for details.

### PostHog — Prompt & Response Logging

All AI prompts (the messages you send to Wren) and the AI's responses are transmitted to and stored in **PostHog** for operational observability purposes. This is always active when you use the Service.

**Important guarantees regarding this data:**

- PostHog stores this data on servers located in the **European Union** (EU data residency), ensuring it remains subject to GDPR protections at rest.
- This data is retained for a maximum of **30 days**, after which it is automatically and permanently deleted.
- This data is **never, under any circumstances, used to train any AI model** — by us, by PostHog, or by any third party. It is used solely for debugging, monitoring response quality, and service reliability.

---

## 8. Data Retention

| Data Category | Retention Period |
|---|---|
| **AI prompts, responses & channel context** (PostHog, EU) | **30 days** — automatically and permanently deleted after this period |
| **Conversation memory** (tenant_memory table) | **Indefinitely** — retained until a Server Owner explicitly deletes it, or the server removes Wren. Server admins can view and manage all stored memories for their server. |
| **Ban records** (Global bans and Per-server bans) | **Indefinitely** — retained permanently under Legitimate Interests (Art. 6(1)(f)) for fraud prevention, abuse detection, and community safety. These records are exempted from GDPR erasure requests. |
| **Audit logs** | Retained indefinitely while the server remains active |
| **Processed event deduplication records** | Automatically purged after their expiry timestamp |
| **Billing & subscription records** | Retained for 7 years from the end of the subscription to comply with financial record-keeping obligations |
| **API tokens** (hashes) | Retained until revoked by the Server Owner |
| **All data** | Deleted within 30 days of a verified erasure request (see Section 11) |

---

## 9. Security

We implement the following technical and organisational measures to protect your data:

- **Encryption at rest**: Sensitive API keys and tokens stored in our database are encrypted using AES-256-GCM with a key held exclusively in the server's environment variables.
- **Encryption in transit**: All connections to our API and to third-party services use TLS 1.2+.
- **Hashed tokens**: API access tokens are stored as one-way bcrypt hashes; the raw token cannot be recovered even by us.
- **Rate limiting**: Our REST API enforces per-token rate limits to prevent abuse.
- **Principle of least privilege**: Database credentials and API keys are scoped to the minimum permissions required.

---

## 10. Data Breach Notification

In the event of a personal data breach, Atria will:

- **Notify the relevant supervisory authority** (the Irish Data Protection Commission, or the UK ICO where applicable) **within 72 hours** of becoming aware of the breach, where it is likely to result in a risk to your rights and freedoms.
- **Notify affected individuals** without undue delay where the breach is likely to result in a high risk to their rights and freedoms, including information about the nature of the breach, the categories of data affected, likely consequences, and the measures taken or proposed.

If you believe you have discovered a security vulnerability or data breach affecting the Service, please report it immediately to [gdpr@atriasafety.org](mailto:gdpr@atriasafety.org).

---

## 11. Your Rights Under GDPR

If you are located in the European Economic Area (EEA), United Kingdom, or Switzerland, you have the following rights:

| Right | Description |
|---|---|
| **Right of Access (Art. 15)** | Request a copy of the personal data we hold about you. |
| **Right to Rectification (Art. 16)** | Request correction of inaccurate data. |
| **Right to Erasure (Art. 17)** | Request deletion of your personal data ("right to be forgotten"). *Note: Ban records are retained under Legitimate Interests for safety and moderation.* |
| **Right to Restriction (Art. 18)** | Request that we restrict processing of your data. |
| **Right to Data Portability (Art. 20)** | Request your data in a structured, machine-readable format. We do not currently have an automated export tool — requests are fulfilled manually by our team, who will extract your data from our database and provide it to you. |
| **Right to Object (Art. 21)** | Object to processing based on legitimate interests. |
| **Right to Withdraw Consent (Art. 7(3))** | Where processing is based on consent, withdraw it at any time. |

**To exercise any of these rights**, contact our DPO at [dpo@atriasafety.org](mailto:dpo@atriasafety.org) or email [help@atriasafety.org](mailto:help@atriasafety.org). We will respond within **30 days** as required by GDPR. For erasure requests, you may also open a support ticket in our Discord at [atriasfty.org/discord](https://atriasfty.org/discord).

If you believe we have not handled your data lawfully, you have the right to lodge a complaint with your local supervisory authority. In the UK, this is the [Information Commissioner's Office (ICO)](https://ico.org.uk/). In Ireland, this is the [Data Protection Commission (DPC)](https://www.dataprotection.ie/).

---

## 12. International Data Transfers & EU Representative

Some of our third-party processors (including OpenRouter and Polar.sh) are based in the United States. Where we transfer personal data outside the EEA, we rely on:

- **Standard Contractual Clauses (SCCs)** approved by the European Commission; and/or
- The processor's participation in recognised cross-border data transfer frameworks.

Our **Data Protection Officer (DPO) is based within the European Union** and serves as our EU representative for the purposes of GDPR Article 27. You may contact them directly at [dpo@atriasafety.org](mailto:dpo@atriasafety.org) for any queries relating to the processing of EU personal data.

You may contact us at [gdpr@atriasafety.org](mailto:gdpr@atriasafety.org) for further information on the specific safeguards in place.

---

## 13. Children's Privacy

Wren is not directed at children under the age of 13. We do not knowingly collect personal data from children. Discord itself requires users to be at least 13 years old. If you believe a child has provided us with data, please contact us immediately at [gdpr@atriasafety.org](mailto:gdpr@atriasafety.org) and we will delete it promptly.

---

## 14. Our Role as Data Controller

Atria acts as the **Data Controller** for all personal data processed in connection with the Service. This means we determine the purposes and means of processing your data, and we are responsible for ensuring that processing is lawful, fair, and transparent.

Discord Server Owners who install Wren are authorised users of the Service. While Server Owners configure how Wren behaves in their servers and can view certain data (such as conversation memories stored for their server), they do not independently determine the purposes or means of processing — Atria retains that responsibility. Server Owners are expected to inform their members that Wren is present and processes messages, and not to configure Wren in ways that would cause Atria to process data unlawfully.

---

## 15. Changes to This Policy

We may update this Privacy Policy from time to time. When we make significant changes, we will update the "Last Updated" date at the top of this document. We encourage you to review this policy periodically. Continued use of Wren after changes constitutes acceptance of the updated policy.

---

## 16. Contact Us

For any privacy-related questions or requests:

| | |
|---|---|
| **General Privacy** | [gdpr@atriasafety.org](mailto:gdpr@atriasafety.org) |
| **Data Protection Officer** | [dpo@atriasafety.org](mailto:dpo@atriasafety.org) |

**Atria** is a fiscally sponsored project of **The Hack Foundation** (d/b/a Hack Club), a 501(c)(3) nonprofit organization (EIN: 81-2908499).
