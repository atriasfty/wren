import { ChannelType } from 'discord.js';
import { resolveTenantByGuildId } from '../tenant/resolve.js';
import { isTicketProcessed, markTicketProcessed, tryClaimEvent } from '../tenant/store.js';

const TICKET_DEDUPE_PREFIX = 'ticket:';
const TICKET_DEDUPE_TTL_HOURS = 24;

export function attachTicketHandler(client) {
  client.on('channelCreate', async (channel) => {
    if (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.PrivateThread && channel.type !== ChannelType.PublicThread) return;
    if (!channel.guild) return;

    const tenantCtx = await resolveTenantByGuildId(channel.guild.id);
    if (!tenantCtx) return;

    const categoryId = tenantCtx.tenant.ticketCategoryId;
    if (!categoryId) return;
    if (channel.parentId !== categoryId) return;

    const eventId = `${TICKET_DEDUPE_PREFIX}${channel.id}`;
    const claimed = await tryClaimEvent({
      tenantId: tenantCtx.tenantId,
      eventId,
      ttlSeconds: TICKET_DEDUPE_TTL_HOURS * 3600,
    });
    if (!claimed) return;

    await markTicketProcessed({ tenantId: tenantCtx.tenantId, channelId: channel.id });

    const opener = channel.permissionOverwrites.cache.find((p) => p.type === 1)?.id;
    const botName = tenantCtx.tenant.botDisplayName || 'Wren';
    const greeting = `Hello — a staff member will be with you shortly. While you wait, please describe your issue and include any relevant screenshots. (Automated message from ${botName}.)`;

    try {
      await channel.send({
        content: greeting,
        allowedMentions: { parse: [] },
      });
      if (opener) {
        const openerUser = await channel.guild.members.fetch(opener).catch(() => null);
        if (openerUser) {
          await channel.send({
            content: `<@${openerUser.id}>, your ticket has been opened.`,
            allowedMentions: { users: [openerUser.id] },
          });
        }
      }
    } catch (err) {
      console.warn('[ticket] could not post greeting:', err.message);
    }
  });
}
