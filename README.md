# ERLC Discord Bot with Gemini AI & RAG

A Discord bot designed to help ERLC (Emergency Response: Liberty County) moderators by answering questions about server rules, guides, and handbooks using Google's Gemini API and Retrieval-Augmented Generation (RAG).

## Features

- 🤖 Powered by Google Gemini AI
- 📚 RAG (Retrieval-Augmented Generation) for accurate answers from your knowledge base
- 💬 Easy-to-use Discord commands
- 🔍 Semantic search through your documentation
- 📜 Automatically processes chat logs (last 30 days)
- 🌐 Fetches latest documentation from your website
- 🎯 Multi-source knowledge base (manual docs, website, chat history)

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment Variables

Create a `.env` file in the root directory:

```bash
cp .env.example .env
```

Then edit `.env` and add your credentials:

```
DISCORD_TOKEN=your_discord_bot_token_here
GEMINI_API_KEY=your_gemini_api_key_here
COMMAND_PREFIX=!
PROGRESS_CHANNEL_ID=1395220757784825877
```

**How to get credentials:**

- **Discord Token**: 
  1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
  2. Create a new application
  3. Go to "Bot" section and create a bot
  4. Copy the token
  5. Enable "Message Content Intent" under Privileged Gateway Intents

- **Gemini API Key**:
  1. Go to [Google AI Studio](https://makersuite.google.com/app/apikey)
  2. Create an API key

### 3. Add Your Knowledge Base

The bot automatically ingests from multiple sources:

1. **Your Documentation Website** (`https://lacrp.ciankelly.xyz/`)
   - Automatically fetched during ingestion
   - Includes Server Rules, Staff Handbook, STS Guide

2. **Chat Logs** (folder `1395208327293702195/`)
   - Last 30 days of chat history
   - Automatically processed during ingestion

3. **Manual Documentation** (`data/input.txt`) - Optional
   - Add any additional information not on the website
   - Leave empty if you don't need it

### 4. Process the Knowledge Base

Run the ingestion script to create embeddings from all sources:

```bash
npm run ingest
```

**⏱️ Processing Time:** Approximately 10-20 minutes due to API rate limits (15 requests/minute)

**Progress Updates:**
- ✅ Real-time progress in console
- ✅ Status updates sent to Discord channel (ID: 1395220757784825877)
- ✅ Estimated time remaining displayed

This will:
- Fetch documentation from https://lacrp.ciankelly.xyz/
- Process last 30 days of chat logs (filtered for meaningful content)
- Process any manual documentation from `data/input.txt`
- Create ~200-400 searchable chunks with embeddings
- Save to `data/vector-store.json`

**Rate Limits (Gemini API):**
- 1,000 requests per day
- 15 requests per minute
- 250k tokens per minute

### 5. Start the Bot

```bash
npm start
```

Or for development with auto-restart:

```bash
npm run dev
```

## Usage

Once the bot is running in your Discord server, moderators can use these commands:

- `!ask [question]` - Ask any question about server rules, guides, or procedures
- `!help [question]` - Same as `!ask`
- `!ping` - Check if the bot is online
- `!commands` - Show available commands

### Examples

```
!ask What is the punishment for RDM?
!ask How do I handle a false report?
!ask What are the vehicle speed limits?
!help What is FailRP?
```

## How It Works

1. **Document Ingestion**: 
   - Fetches documentation from your website (https://lacrp.ciankelly.xyz/)
   - Processes last 30 days of chat logs from Discord
   - Reads any manual documentation from `data/input.txt`
   - Splits content into chunks and converts them into embeddings using Gemini's embedding model

2. **Query Processing**: When a moderator asks a question, the bot generates an embedding for the question

3. **Retrieval**: The system finds the most relevant chunks from all sources using semantic similarity

4. **Generation**: The relevant context is sent to Gemini along with the question to generate an accurate, context-aware answer

## Project Structure

```
erlc-discord-bot/
├── src/
│   ├── index.js          # Main bot file
│   ├── rag.js            # RAG implementation
│   └── ingest.js         # Document ingestion script
├── data/
│   ├── input.txt         # Your knowledge base (add your content here)
│   └── vector-store.json # Generated embeddings (created by ingest script)
├── .env                  # Environment variables (create this)
├── .env.example          # Example environment file
├── package.json
└── README.md
```

## Troubleshooting

- **"No vector store found"**: Run `npm run ingest` first
- **Bot not responding**: Check that Message Content Intent is enabled in Discord Developer Portal
- **Rate limiting**: Add delays between questions if hitting API limits

## Re-indexing

Whenever you want to update the knowledge base with:
- New chat logs
- Updated website content
- New manual documentation

Simply re-run:

```bash
npm run ingest
```

The bot doesn't need to be restarted after re-indexing. It's recommended to re-run this weekly or when major updates are made to your documentation.

## License

ISC
