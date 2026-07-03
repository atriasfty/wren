#!/usr/bin/env node

// Note: To run this server, you must install @modelcontextprotocol/sdk.
// E.g., npm install @modelcontextprotocol/sdk

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { query } from "../db/pool.js";
import crypto from 'crypto';

// The MCP token and Tenant ID will be provided by Claude via environment variables
const MCP_TOKEN = process.env.WREN_MCP_TOKEN;
const TENANT_ID = process.env.WREN_TENANT_ID;

if (!MCP_TOKEN || !TENANT_ID) {
  console.error("Missing WREN_MCP_TOKEN or WREN_TENANT_ID environment variables.");
  process.exit(1);
}

// Scaffold MCP Server
const server = new Server(
  {
    name: "wren-mcp-server",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Verify the token before allowing access
async function verifyAccess() {
  const tokenHash = crypto.createHash('sha256').update(MCP_TOKEN).digest('hex');
  const res = await query('SELECT discord_id FROM user_mcp_tokens WHERE tenant_id = $1 AND token_hash = $2 AND revoked_at IS NULL', [TENANT_ID, tokenHash]);
  
  if (res.rows.length === 0) {
    throw new Error("Invalid or revoked Wren MCP Token.");
  }
  
  // Update last used
  await query('UPDATE user_mcp_tokens SET last_used_at = NOW() WHERE tenant_id = $1 AND token_hash = $2', [TENANT_ID, tokenHash]);
  
  return res.rows[0].discord_id;
}

server.setRequestHandler(ListToolsRequestSchema, async () => {
  // Ensure they are authenticated
  await verifyAccess();
  
  return {
    tools: [
      {
        name: "read_server_rules",
        description: "Search the ERLC server's vector database (RAG) to answer rules queries.",
        inputSchema: {
          type: "object",
          properties: {
            search_query: { type: "string" }
          },
          required: ["search_query"]
        }
      },
      // Example of other tools we'd implement:
      // fetch_active_modcalls, execute_erlc_command, check_player_history
    ]
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const discordId = await verifyAccess();
  
  if (request.params.name === "read_server_rules") {
    const q = request.params.arguments.search_query;
    
    // Here we would call the retrieval/RAG pipeline:
    // const results = await retrieve(TENANT_ID, q);
    
    return {
      content: [
        {
          type: "text",
          text: `[WIP] Searched rules for: ${q}. (Retrieval logic to be wired up).`
        }
      ]
    };
  }
  
  throw new Error("Tool not found");
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Wren MCP server running on stdio");
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
