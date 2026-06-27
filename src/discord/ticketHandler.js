import { resolveTenantByGuildId } from '../tenant/resolve.js';
import { isTicketProcessed, markTicketProcessed } from '../tenant/store.js';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';

export function attachTicketHandler(client) {
  client.on('channelCreate', async (channel) => {
    if (!channel.guild) return;
    if (!channel.isTextBased()) return;

    const tenantCtx = await resolveTenantByGuildId(channel.guild.id);
    if (!tenantCtx) return;
    
    if (tenantCtx.tenant.subscriptionTier !== 'pro') return;

    const ticketCategories = tenantCtx.tenant.ticketCategoryId;
    if (!ticketCategories) return;
    
    const allowedCategories = ticketCategories.split(',').map(id => id.trim());
    if (!channel.parentId || !allowedCategories.includes(channel.parentId)) return;

    if (await isTicketProcessed({ tenantId: channel.guild.id, channelId: channel.id })) {
      return;
    }

    // Wait 10 seconds for ticketing bots to post their embeds/initial prompts
    setTimeout(async () => {
      try {
        if (await isTicketProcessed({ tenantId: channel.guild.id, channelId: channel.id })) {
          return;
        }
        await markTicketProcessed({ tenantId: channel.guild.id, channelId: channel.id });

        const embed = new EmbedBuilder()
          .setTitle('Wren AI Assistant')
          .setDescription('Hello! I\'m Wren, an AI assistant. I can help resolve your ticket automatically. To proceed, please accept the Terms of Service and Privacy Policy.')
          .setColor('#0099ff')
          .addFields(
            { name: 'Documentation', value: 'https://wren.atriasafety.org' },
            { name: 'Terms of Service', value: 'http://atriasfty.org/wren-tos' },
            { name: 'Privacy Policy', value: 'http://atriasfty.org/wren-privacy' }
          );
        
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('agree_ticket_tos')
            .setLabel('Agree & Continue')
            .setStyle(ButtonStyle.Primary)
        );

        await channel.send({ embeds: [embed], components: [row] });
      } catch (err) {
        console.error('[ticketHandler] Failed to process ticket:', err);
      }
    }, 10000);
  });
}
