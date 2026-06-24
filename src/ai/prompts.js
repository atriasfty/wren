function serverInfoBlock(tenantCtx) {
  const t = tenantCtx.tenant;
  return [
    `Server: ${t.displayName}`,
    t.coreInfo ? `\n${t.coreInfo}\n` : '',
  ].filter(Boolean).join('\n');
}

function identityBlock(actor) {
  if (!actor) return '';
  if (actor.kind === 'discord' && actor.member) {
    const id = actor.member.id || actor.member.user?.id;
    const name = actor.member.user?.username || actor.member.displayName || 'Unknown';
    return `\nCURRENT USER:\nYou are talking to a Discord user. Their username is "${name}" and their Discord ID is "${id}".\n`;
  }
  if (actor.kind === 'in_game' && actor.playerName) {
    return `\nCURRENT USER:\nYou are talking to a Roblox player in-game. Their username is "${actor.playerName}".\n`;
  }
  return '';
}

function responseStyleBlock(tenantCtx) {
  const t = tenantCtx.tenant;
  if (!t.responseStyle) return '';
  return `\nRESPONSE STYLE (configured by admins):\n${t.responseStyle}\n`;
}

function memoryBlock(tenantCtx, actorKey = null) {
  const serverMem = tenantCtx.memory.filter((m) => m.scope === 'server');
  const userMem = actorKey ? tenantCtx.memory.filter((m) => m.scope === 'user' && m.user_key === actorKey) : [];
  if (!serverMem.length && !userMem.length) return '';
  const lines = [];
  if (serverMem.length) lines.push('SERVER FACTS:', ...serverMem.map((m) => `• ${m.content}`));
  if (userMem.length) lines.push(`USER FACTS (for ${actorKey}):`, ...userMem.map((m) => `• ${m.content}`));
  return `\nMEMORY:\n${lines.join('\n')}\n`;
}

function sourcesBlock(tenantCtx) {
  if (!tenantCtx.sources.length) return '';
  const grouped = { discord_channel: [], website: [], manual_doc: [] };
  for (const s of tenantCtx.sources) grouped[s.kind]?.push(s);
  const lines = [];
  if (grouped.discord_channel.length) lines.push(`Discord channels (${grouped.discord_channel.length}): ${grouped.discord_channel.map((s) => s.label || s.ref).join(', ')}`);
  if (grouped.website.length) lines.push(`Websites (${grouped.website.length}): ${grouped.website.map((s) => s.label || s.ref).join(', ')}`);
  if (grouped.manual_doc.length) lines.push(`Manual docs (${grouped.manual_doc.length}): ${grouped.manual_doc.map((s) => s.label || s.ref).join(', ')}`);
  return `\nKNOWN SOURCES OF TRUTH:\n${lines.join('\n')}\n`;
}

export function buildSystemPrompt(tenantCtx, { actorKey = null, actor = null, mode = 'discord' } = {}) {
  const parts = [
    `You are ${tenantCtx.tenant.botDisplayName}, a helpful assistant for the ${tenantCtx.tenant.displayName} Discord community and its ERLC server.`,
    identityBlock(actor),
    serverInfoBlock(tenantCtx),
    sourcesBlock(tenantCtx),
    memoryBlock(tenantCtx, actorKey),
    responseStyleBlock(tenantCtx),
    `Respond in the language the user is using. Be direct, factual, and concise. Do not invent player names, usernames, statistics, or events. If unsure, say so. Never output "@everyone" or "@here". Additionally, if the user shares a fact about themselves (e.g., their favorite car, timezone, name) or if a staff/admin establishes a new server-wide rule, use the "save_memory" tool to proactively save it.`,
    `You were made by Atria, a fiscally sponsored non-profit of the Hack Foundation (atriasafety.org). Your support Discord is atriasfty.org/discord.`,
  ];
  return parts.filter(Boolean).join('\n');
}