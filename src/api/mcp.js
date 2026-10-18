import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import express from 'express';
import crypto from 'crypto';
import { query } from '../db/pool.js';
import { logAudit } from '../tenant/store.js';
import { resolveTenantById } from '../tenant/resolve.js';
import { retrieveSources } from '../rag/retrieve.js';
import { executeTool } from '../ai/executor.js';
import { TOOL_DEFS } from '../ai/tools.js';
import { mcpAuthFailures } from '../metrics.js';

const transports = new Map();
const MAX_SESSIONS_PER_TOKEN = 3;
const MAX_SESSIONS_TOTAL = 200;

async function tokenStillValid(tokenHash) {
  const r = await query('SELECT 1 FROM user_mcp_tokens WHERE token_hash = $1 AND revoked_at IS NULL', [tokenHash]);
  return r.rows.length > 0;
}

export function getActiveMcpConnectionCount() {
  return transports.size;
}

// The specific ERLC tools we want to expose via MCP
const ALLOWED_ERLC_TOOLS = [
  'tp_player', 'kill_player', 'mod_player', 'unmod_player', 
  'admin_player', 'unadmin_player', 'get_vehicles', 
  'get_player_profile', 'get_wanted_players', 'get_player_location', 
  'search_command_logs', 'get_server_stats', 'list_online_players', 
  'ban_player', 'kick_player', 'send_pm', 'check_if_online', 'check_if_staff',
  'get_player_info', 'analyze_player_activity', 'lookup_roblox_profile', 'get_server_briefing'
];

// Middleware to authenticate MCP requests via the token
async function mcpAuth(req, res, next) {
  // Tokens are only accepted via the Authorization header — query-string tokens
  // leak into access logs and proxies.
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';

  if (!token) {
    mcpAuthFailures.inc();
    return res.status(401).json({ error: 'Missing MCP token' });
  }

  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  try {
    const dbRes = await query('SELECT tenant_id, discord_id FROM user_mcp_tokens WHERE token_hash = $1 AND revoked_at IS NULL', [tokenHash]);
    if (dbRes.rows.length === 0) {
      mcpAuthFailures.inc();
      return res.status(403).json({ error: 'Invalid or revoked MCP token' });
    }
    
    req.mcpSession = {
      tenantId: dbRes.rows[0].tenant_id,
      discordId: dbRes.rows[0].discord_id,
      tokenHash
    };
    
    // Update last used asynchronously
    query('UPDATE user_mcp_tokens SET last_used_at = NOW() WHERE token_hash = $1', [tokenHash]).catch(() => {});
    
    next();
  } catch (err) {
    console.error('[mcp] auth error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export function createMcpRouter(client) {
  const router = express.Router();
  
  // Endpoint to establish SSE connection
  router.get('/sse', mcpAuth, async (req, res) => {
    const { tenantId, discordId, tokenHash } = req.mcpSession;
    if (transports.size >= MAX_SESSIONS_TOTAL) {
      return res.status(503).json({ error: 'Too many MCP sessions; try again later' });
    }
    let perToken = 0;
    for (const s of transports.values()) if (s.mcpSession.tokenHash === tokenHash) perToken++;
    if (perToken >= MAX_SESSIONS_PER_TOKEN) {
      return res.status(429).json({ error: `At most ${MAX_SESSIONS_PER_TOKEN} concurrent MCP sessions per token` });
    }

    const transport = new SSEServerTransport('/api/mcp/message', res);
    
    // Create a dedicated server instance for this connection
    const server = new Server(
      { name: 'wren-mcp', version: '1.0.0' },
      { capabilities: { tools: {} } }
    );
    
    server.setRequestHandler(ListToolsRequestSchema, async () => {
      const mcpTools = TOOL_DEFS
        .filter(t => ALLOWED_ERLC_TOOLS.includes(t.name))
        .map(t => ({
          name: t.name,
          description: t.description,
          inputSchema: t.params
        }));

      // Add the custom RAG tool which is handled separately from executor.js
      mcpTools.unshift({
        name: "read_server_rules",
        description: "Search the ERLC server's RAG knowledge base for rules or server information.",
        inputSchema: {
          type: "object",
          properties: {
            search_query: { type: "string", description: "What you want to look up in the rules." }
          },
          required: ["search_query"]
        }
      });

      return { tools: mcpTools };
    });

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const toolName = request.params.name;
      const args = request.params.arguments || {};

      // A token revoked while this SSE session is open must stop working now,
      // not when the socket eventually closes.
      if (!(await tokenStillValid(tokenHash))) {
        throw new Error('MCP token has been revoked.');
      }
      
      // Log the tool execution in audit log
      await logAudit(tenantId, discordId, 'mcp_tool_execution', { tool: toolName, args });
      
      const tenantCtx = await resolveTenantById(tenantId);
      if (!tenantCtx) throw new Error('Tenant not configured properly.');

      // Fetch the actual Discord member to correctly enforce policy permissions
      let actor = { kind: 'api', discordId };
      try {
        const guild = await client.guilds.fetch(tenantId);
        const member = await guild.members.fetch(discordId);
        if (member) {
          actor = { kind: 'discord', member };
        }
      } catch (err) {
        console.error(`[mcp] Failed to resolve discord member ${discordId} in guild ${tenantId}:`, err);
        throw new Error('Failed to verify Discord permissions. Are you still in the server?', { cause: err });
      }

      try {
        let textResult = '';
        
        if (toolName === "read_server_rules") {
          const results = await retrieveSources(tenantCtx, args.search_query, 8);
          textResult = results.map(r => `Source (${r.chunk.label || r.chunk.sourceRef}):\n${r.chunk.text}`).join('\n\n') || 'No rules found for this query.';
        } else if (ALLOWED_ERLC_TOOLS.includes(toolName)) {
          // Pass the execution directly to the core AI executor engine!
          const resultObj = await executeTool(tenantCtx, toolName, args, actor);
          textResult = typeof resultObj === 'string' ? resultObj : JSON.stringify(resultObj, null, 2);
        } else {
          throw new Error(`Tool not found: ${toolName}`);
        }
        
        return { content: [{ type: "text", text: textResult }] };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Error executing ${toolName}: ${err.message}` }],
          isError: true
        };
      }
    });

    // Register (and arm cleanup) before connecting, so a client that drops
    // during connect() doesn't leave a dangling entry behind.
    transports.set(transport.sessionId, { transport, server, mcpSession: req.mcpSession });
    res.on('close', () => {
      transports.delete(transport.sessionId);
      server.close().catch(() => {});
    });

    try {
      await server.connect(transport);
    } catch (err) {
      console.error('[mcp] connect failed:', err.message);
      transports.delete(transport.sessionId);
      if (!res.headersSent) res.status(500).end();
    }
  });

  // Endpoint to handle incoming messages from the client
  // The session id alone isn't a credential (it appears in the SSE endpoint
  // URL and can end up in logs), so the poster must present the same token
  // that opened the session.
  router.post('/message', mcpAuth, async (req, res) => {
    const sessionId = req.query.sessionId;
    const sessionData = transports.get(sessionId);
    if (!sessionData || sessionData.mcpSession.tokenHash !== req.mcpSession.tokenHash) {
      return res.status(404).send('Session not found');
    }

    try {
      // express.json() has already consumed the request stream, so hand the
      // parsed body over instead of letting the transport re-read it.
      await sessionData.transport.handlePostMessage(req, res, req.body);
    } catch (err) {
      console.error('[mcp] message handling failed:', err.message);
      if (!res.headersSent) res.status(500).send('Message handling failed');
    }
  });

  return router;
}
