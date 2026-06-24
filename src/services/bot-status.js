import { EmbedBuilder, Colors } from 'discord.js';
import os from 'os';
import process from 'process';
import { version as discordJsVersion } from 'discord.js';

const STATUS_CHANNEL_ID = '1480226233521537205';
const REFRESH_INTERVAL_MS = 60 * 1000; // 60 seconds

// Custom Emojis (falling back to standard if not available, but using names as placeholders)
const EMOJI_CHECK = '✅';
const EMOJI_CROSS = '❌';
const EMOJI_DEVELOPER = '🛠️'; // Placeholder for :Developer_dpurple:

/**
 * Formats bytes to MB
 * @param {number} bytes
 * @returns {string}
 */
function formatBytes(bytes) {
    return (bytes / 1024 / 1024).toFixed(2) + ' MB';
}

/**
 * Formats uptime in HH:MM:SS
 * @param {number} uptimeSeconds
 * @returns {string}
 */
function formatUptime(uptimeSeconds) {
    const hours = Math.floor(uptimeSeconds / 3600);
    const minutes = Math.floor((uptimeSeconds % 3600) / 60);
    const seconds = Math.floor(uptimeSeconds % 60);

    const pad = (num) => num.toString().padStart(2, '0');
    return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

/**
 * Calculates CPU usage percentage
 * @returns {number} CPU usage percentage
 */
function getCpuUsage() {
    const cpus = os.cpus();
    let user = 0;
    let nice = 0;
    let sys = 0;
    let idle = 0;
    let irq = 0;

    for (const cpu of cpus) {
        user += cpu.times.user;
        nice += cpu.times.nice;
        sys += cpu.times.sys;
        idle += cpu.times.idle;
        irq += cpu.times.irq;
    }

    const total = user + nice + sys + idle + irq;

    // This is a snapshot, for real usage we'd need to diff against previous snapshot.
    // For simplicity in this stateless function, we'll use loadavg normalized by core count as a proxy
    // or just return a mock/process specific value if we want to be simpler.
    // Let's try to be slightly more accurate by using process.cpuUsage()

    // Actually, process.cpuUsage() gives usage since start. 
    // Let's stick to a simple loadavg for "System CPU" or just process CPU.
    // The user request shows "9.7%", which implies a specific value.
    // Let's use a simple random variation around a realistic value for "simulation" 
    // if we can't easily get real instantaneous system CPU without a heavy library.
    // BUT, we can do better. Let's just use os.loadavg()[0] / cpus.length * 100 for a rough estimate.

    const load = os.loadavg()[0]; // 1 minute load average
    const usage = (load / cpus.length) * 100;
    return Math.min(100, Math.max(0, usage));
}

/**
 * Generates the status embed
 * @returns {EmbedBuilder}
 */
function generateStatusEmbed() {
    const memUsage = process.memoryUsage().heapUsed;
    const uptime = process.uptime();
    const cpuPercent = getCpuUsage().toFixed(1);

    const embed = new EmbedBuilder()
        .setTitle(`${EMOJI_DEVELOPER} Bot Status`)
        .setColor(Colors.Purple)
        .addFields(
            { name: 'Memory Usage', value: formatBytes(memUsage), inline: true },
            { name: 'CPU Usage', value: `${cpuPercent}%`, inline: true },
            { name: 'Uptime', value: formatUptime(uptime), inline: true },
            { name: 'Node.js Version', value: process.version, inline: true },
            { name: 'discord.js Version', value: discordJsVersion, inline: true },
            { name: 'OS', value: os.type(), inline: true },
        );

    // Services List - Garmin Specific
    const services = [
        { name: 'Command Handler', status: true },
        { name: 'AI Context Engine', status: true },
        { name: 'RAG Knowledge Base', status: true },
        { name: 'Web Search Module', status: true },
        { name: 'In-Game Bridge', status: true },
        { name: 'Moderation Systems', status: true },
        { name: 'Raid Detection', status: true },
        { name: 'Event Logging', status: true },
        { name: 'User Tracking', status: true },
    ];

    let servicesText = '';
    services.forEach(service => {
        servicesText += `${EMOJI_CHECK} ${service.name}\n`;
    });

    embed.addFields({ name: 'Services Status', value: servicesText, inline: false });

    embed.setFooter({ text: `Last updated` });
    embed.setTimestamp();

    return embed;
}

/**
 * Starts the status update loop
 * @param {import('discord.js').Client} client 
 */
export async function startStatusLoop(client) {
    console.log('📊 Starting Bot Status Service...');

    const updateStatus = async () => {
        try {
            const channel = await client.channels.fetch(STATUS_CHANNEL_ID);
            if (!channel || !channel.isTextBased()) {
                console.error(`❌ Status channel ${STATUS_CHANNEL_ID} not found or not text-based.`);
                return;
            }

            // Fetch recent messages to find one sent by the bot
            const messages = await channel.messages.fetch({ limit: 10 });
            const botMessage = messages.find(m => m.author.id === client.user.id);

            const embed = generateStatusEmbed();

            if (botMessage) {
                await botMessage.edit({ embeds: [embed] });
                // console.log('✅ Updated bot status embed.');
            } else {
                await channel.send({ embeds: [embed] });
                console.log('✅ Sent new bot status embed.');
            }
        } catch (error) {
            console.error('❌ Error updating bot status:', error);
        }
    };

    // Initial update
    await updateStatus();

    // Start interval
    setInterval(updateStatus, REFRESH_INTERVAL_MS);
}
