# Wren MCP Integration

The **Model Context Protocol (MCP)** implementation in Wren allows server owners and staff to connect their own desktop AI agents (like Claude Desktop, Cursor, or custom clients) directly to their ERLC server's management pipeline. 

By adding Wren as an MCP server, your desktop AI inherits all of the intelligence, OSINT gathering, and moderation capabilities of the normal Wren Discord bot.

---

## Installation

> **Important Prerequisite:** Before using this feature, make sure Wren is completely set up in your Discord server. Wren needs to be fully connected to your game server so that your AI can actually see what's happening in-game and take actions.

In your Discord server, run the slash command:
`/wren mcp`

Wren will generate a cryptographic API token locked to your Discord account. Copy the provided JSON snippet into your MCP client's configuration file.

For **Claude Desktop** (`claude_desktop_config.json`):
```json
"mcpServers": {
  "wren-mcp": {
    "command": "npx",
    "args": [
      "-y",
      "mcp-proxy",
      "https://wrenapi.atriasafety.org/api/mcp/sse"
    ],
    "env": {
      "WREN_MCP_TOKEN": "your_secure_token"
    }
  }
}
```

---

## Security & Permissions

Because MCP connects over a REST API (Server-Sent Events) instead of directly through Discord, Wren implements a strict, live security layer to ensure complete platform integrity. There are **zero security loopholes** for unauthorized access.

1. **Live Role Verification**: Every single time your AI attempts to execute an ERLC tool, the Wren server takes the Discord ID attached to your API token and fetches your **live `GuildMember` object** directly from the Discord server.
2. **Policy Enforcement**: The server feeds your member object into Wren's core policy engine. It checks exactly what Discord roles you *currently* have (e.g. Server Moderator, Server Administrator, Server Owner). If a tool requires "Admin" and you only have "Mod", the AI's execution is forcefully rejected.
3. **Instant Revocation**: Because verification happens live on *every single tool call*, if you generate an MCP token and are later demoted or fired from the staff team in Discord, **your MCP token instantly loses access to all staff tools.** No manual revocation is required.
4. **Audit Logging**: Every single successful tool execution by your AI is recorded in the central database's `audit_log` under your Discord ID. Server owners can always see exactly what an AI agent did on behalf of a staff member.

---

## Available Tools

The MCP Server is fully wired into Wren's core execution engine, giving your AI agent instantaneous access to the following 22 tools:

### Knowledge Base & RAG
* `read_server_rules`: Directly searches the server's RAG vector database. Returns up to 8 of the most relevant rule chunks or server manual documents to answer questions automatically.

### Live Data / Telemetry (OSINT)
* `get_server_briefing`: Generates a massive situational overview (player count, staff online, wanted players, emergency calls, recent kills, modcalls, suspicious vehicles).
* `get_player_profile`: Returns a comprehensive dossier on a player (online status, location, wanted stars, vehicle, team, callsign, account age, kill/death history, command usage).
* `get_server_stats`: Grabs the server name, max players, and current player count.
* `get_vehicles`: Lists all spawned vehicles, who owns them, and their liveries.
* `get_wanted_players`: Lists players who currently have wanted stars.
* `get_player_location`: Gets the street address, postal code, and coordinates of a player.
* `search_command_logs`: Searches recent command-log activity for specific players or actions.
* `analyze_player_activity`: Summarizes a player's recent ERLC activity (joins, kills, commands).
* `list_online_players` & `check_if_online` & `check_if_staff` & `get_player_info`
* `lookup_roblox_profile`: Public Roblox profile lookup.

### Action Execution (Moderation)
* `ban_player`: Issue a ban (either for a duration in days, or permanent) with a reason.
* `kick_player`: Issue a kick with a reason.
* `kill_player`: Kill a player in-game.
* `tp_player`: Teleport one player to another.
* `send_pm`: Send a private message directly to an online user.
* `mod_player` & `unmod_player`: Promote or demote a Server Moderator.
* `admin_player` & `unadmin_player`: Promote or demote a Server Administrator.
