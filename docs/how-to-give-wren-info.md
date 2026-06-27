# How to Give Wren Your Server's Info (Sources)

Wren is smart, but it doesn't know the rules or specific mechanics of your individual Discord server or Roblox game out of the box. To make Wren truly useful for your community, you need to provide it with **Sources**. 

Sources are documents, websites, or Discord channels that Wren will read, memorize, and use to answer questions accurately.

---

## What Types of Sources Can I Add?

Currently, Wren supports three types of sources:
1. **Discord Channels (`discord_channel`)**: A read-only channel in your server where you post rules, announcements, or server info.
2. **Websites (`website`)**: A public URL (like a Notion page, a Google Doc published to the web, or a wiki).
3. **Manual Documents (`manual_doc`)**: Direct text that you paste into Wren's configuration.

---

## How to Add a Source

You must have the "Manage Server" permission to manage sources.

### Step 1: Open the Sources Menu
In any channel, type:
```
/wren sources add
```

### Step 2: Fill out the Command Options
The command will prompt you for a few details:
- **`kind`**: Choose the type of source (`discord_channel`, `website`, or `manual_doc`).
- **`ref`**: This is the actual link or ID. 
  - If you chose `discord_channel`, paste the Channel ID (e.g., `123456789012345678`).
  - If you chose `website`, paste the full URL (e.g., `https://my-community-rules.com`).
  - If you chose `manual_doc`, type a short label for it (e.g., `staff_guidelines`).
- **`label`** (Optional): A friendly name for this source so you can remember what it is.

### Step 3: Run the Command
Hit enter! Wren will save the source to your database. 

*If you chose `manual_doc`, Wren will immediately open a text box where you can paste the full text of your document.*

---

## How Does Wren Read the Sources?

Adding a source doesn't mean Wren instantly knows everything in it. Wren runs a background process called **Ingestion** to read and index your sources. 

- **Automatic Ingestion:** Wren automatically checks your `discord_channel` sources for new messages and reads them in real-time. 
- **Manual Ingestion:** If you added a `website`, or if you want to force Wren to re-read everything immediately, the **Server Owner** can run:
  ```
  /wren ingest status
  ```
  This will queue your server for a full sync. Once it finishes, Wren will have perfect knowledge of your server's info!

---

## Managing Your Sources

You can view all the sources you've added by running:
```
/wren sources list
```

If a document becomes outdated or you want Wren to stop referencing a specific channel, you can easily delete it:
```
/wren sources remove kind:<kind> ref:<ref>
```
*(You can find the exact `kind` and `ref` by looking at your sources list).*
