import { Client, GatewayIntentBits, ButtonBuilder, ButtonStyle, ActionRowBuilder } from 'discord.js';
import { looksLikeQuestion, classifyMessage } from './classifier.js';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const TRAINING_CHANNEL_ID = '1395220757784825877';
const PRIMARY_SOURCE_CHANNEL_ID = '1421897577879568536'; // 75% of training data from here
const MAX_MESSAGES = 2000;
const TARGET_PRIMARY = 1500; // 75% from primary channel
const TARGET_RANDOM = 500;   // 25% from random channels
const TRAINING_DATA_FILE = path.join(__dirname, '..', 'training-data.json');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

let trainingData = [];
let currentIndex = 0;
let messagesToClassify = [];
let trainingInProgress = false;

// Load existing training data if it exists
function loadTrainingData() {
  try {
    if (fs.existsSync(TRAINING_DATA_FILE)) {
      const data = fs.readFileSync(TRAINING_DATA_FILE, 'utf8');
      trainingData = JSON.parse(data);
      console.log(`📚 Loaded ${trainingData.length} existing training examples`);
    }
  } catch (error) {
    console.error('Error loading training data:', error);
    trainingData = [];
  }
}

// Save training data
function saveTrainingData() {
  try {
    fs.writeFileSync(TRAINING_DATA_FILE, JSON.stringify(trainingData, null, 2));
    console.log(`💾 Saved ${trainingData.length} training examples`);
  } catch (error) {
    console.error('Error saving training data:', error);
  }
}

// Collect messages from all channels
async function collectMessages(guild) {
  console.log('\n🔍 Collecting messages from channels...');
  const primaryMessages = [];
  const randomMessages = [];
  
  // First, fetch from primary channel (75%)
  try {
    const primaryChannel = await guild.channels.fetch(PRIMARY_SOURCE_CHANNEL_ID);
    if (primaryChannel && primaryChannel.isTextBased()) {
      console.log(`📥 Fetching ${TARGET_PRIMARY} messages from PRIMARY #${primaryChannel.name}...`);
      
      let lastId = null;
      
      while (primaryMessages.length < TARGET_PRIMARY) {
        const options = { limit: 100 };
        if (lastId) options.before = lastId;
        
        const messages = await primaryChannel.messages.fetch(options);
        if (messages.size === 0) break;
        
        messages.forEach(msg => {
          if (!msg.author.bot && msg.content.length >= 5 && primaryMessages.length < TARGET_PRIMARY) {
            primaryMessages.push({
              content: msg.content,
              author: msg.author.username,
              channel: primaryChannel.name,
              timestamp: msg.createdAt.toISOString(),
              id: msg.id
            });
          }
        });
        
        lastId = messages.last().id;
        
        if (messages.size < 100) break;
      }
      
      console.log(`  ✓ Collected ${primaryMessages.length} messages from PRIMARY channel`);
    }
  } catch (err) {
    console.log(`  ⚠️ Could not fetch from primary channel:`, err.message);
  }
  
  // Then collect from random channels (25%)
  console.log(`📥 Fetching ${TARGET_RANDOM} messages from random channels...`);
  const channels = guild.channels.cache.filter(ch => 
    ch.isTextBased() && 
    ch.id !== PRIMARY_SOURCE_CHANNEL_ID && // Exclude primary channel
    ch.permissionsFor(guild.members.me).has('ReadMessageHistory')
  );
  
  console.log(`📡 Found ${channels.size} other accessible channels`);
  
  for (const [channelId, channel] of channels) {
    if (randomMessages.length >= TARGET_RANDOM) break;
    
    try {
      const messagesNeeded = Math.min(50, TARGET_RANDOM - randomMessages.length);
      const messages = await channel.messages.fetch({ limit: messagesNeeded });
      
      messages.forEach(msg => {
        if (!msg.author.bot && msg.content.length >= 5 && randomMessages.length < TARGET_RANDOM) {
          randomMessages.push({
            content: msg.content,
            author: msg.author.username,
            channel: channel.name,
            timestamp: msg.createdAt.toISOString(),
            id: msg.id
          });
        }
      });
      
    } catch (err) {
      // Silently skip channels we can't access
    }
  }
  
  console.log(`  ✓ Collected ${randomMessages.length} messages from random channels`);
  
  const allMessages = [...primaryMessages, ...randomMessages];
  console.log(`\n✅ Total collected: ${allMessages.length} messages`);
  console.log(`   📊 Primary channel: ${primaryMessages.length} (${Math.round(primaryMessages.length / allMessages.length * 100)}%)`);
  console.log(`   📊 Random channels: ${randomMessages.length} (${Math.round(randomMessages.length / allMessages.length * 100)}%)`);
  
  return allMessages;
}

// Filter messages - get random sample for manual labeling
async function filterQuestions(messages) {
  console.log('\n🔍 Selecting random messages for training...');
  const selected = [];
  const targetTotal = 200; // Total messages to present
  
  // Shuffle messages first for randomness
  const shuffled = [...messages];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  
  // Select messages and get classifier's opinion
  for (const msg of shuffled) {
    if (selected.length >= targetTotal) break;
    
    // Check if it looks like a question first
    const looksLikeQ = looksLikeQuestion(msg.content);
    
    try {
      // Get classifier's opinion for reference
      const classification = await classifyMessage(msg.content, msg.id);
      
      selected.push({
        ...msg,
        classifierSays: classification,
        looksLikeQuestion: looksLikeQ
      });
      
      const icon = classification === 'ignore' ? '❌' : '✅';
      const label = classification === 'ignore' ? 'Would Ignore' : 'Would Answer';
      console.log(`  ${icon} ${label} (${selected.length}/${targetTotal}): "${msg.content.substring(0, 40)}..."`);
      
    } catch (error) {
      console.error('Classification error:', error);
    }
  }
  
  console.log(`\n✅ Collected ${selected.length} messages for manual labeling`);
  console.log(`   (Mix of messages the classifier would answer and ignore)`);
  console.log(`   📊 Total: ${selected.length} messages\n`);
  
  return selected;
}

// Ask user about a message
async function askAboutMessage(channel, message) {
  const embed = {
    color: 0x3498db,
    title: `Training Example ${currentIndex + 1}/${messagesToClassify.length}`,
    fields: [
      {
        name: '💬 Message',
        value: `"${message.content}"`
      },
      {
        name: '📊 Classifier Says',
        value: message.classifierSays === 'ignore' 
          ? '❌ Would Ignore (do not respond)' 
          : message.classifierSays === 'server-question'
          ? '🎮 Would Answer: Server Question'
          : '🌐 Would Answer: General Question'
      },
      {
        name: '🔍 Pre-filter',
        value: message.looksLikeQuestion ? '✅ Looks like question' : '❌ Filtered by looksLikeQuestion()'
      },
      {
        name: '📝 Context',
        value: `From: ${message.author} in #${message.channel}\nDate: ${new Date(message.timestamp).toLocaleDateString()}`
      }
    ],
    footer: {
      text: 'Should Garmin respond to this message?'
    }
  };
  
  const row = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId('train_yes')
        .setLabel('✅ Yes, Respond')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId('train_no')
        .setLabel('❌ No, Ignore')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId('train_skip')
        .setLabel('⏭️ Skip')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('train_stop')
        .setLabel('⏹️ Stop Training')
        .setStyle(ButtonStyle.Secondary)
    );
  
  await channel.send({ embeds: [embed], components: [row] });
}

client.on('ready', () => {
  console.log(`✅ Training bot logged in as ${client.user.tag}!`);
  console.log(`📚 Starting classifier training session...\n`);
  loadTrainingData();
});

client.on('messageCreate', async (message) => {
  // Only respond to commands in training channel
  if (message.channel.id !== TRAINING_CHANNEL_ID) return;
  if (message.author.bot) return;
  
  const content = message.content.toLowerCase();
  
  if (content === '!train' || content === '!start') {
    if (trainingInProgress) {
      return message.reply('⚠️ Training is already in progress!');
    }
    
    message.reply('🚀 Starting training session! Collecting messages...');
    trainingInProgress = true;
    
    try {
      // Collect messages
      const allMessages = await collectMessages(message.guild);
      
      // Filter for questions
      messagesToClassify = await filterQuestions(allMessages);
      
      if (messagesToClassify.length === 0) {
        trainingInProgress = false;
        return message.channel.send('❌ No messages found that look like questions!');
      }
      
      currentIndex = 0;
      message.channel.send(`📋 Ready to review ${messagesToClassify.length} messages!\n\nStarting now...`);
      
      // Start showing messages
      setTimeout(() => askAboutMessage(message.channel, messagesToClassify[currentIndex]), 1000);
      
    } catch (error) {
      console.error('Error during training:', error);
      message.channel.send('❌ Error collecting messages: ' + error.message);
      trainingInProgress = false;
    }
  }
  
  if (content === '!stats') {
    const stats = {
      total: trainingData.length,
      shouldRespond: trainingData.filter(d => d.shouldRespond).length,
      shouldIgnore: trainingData.filter(d => !d.shouldRespond).length,
      serverQuestions: trainingData.filter(d => d.shouldRespond && d.classifierSays === 'server-question').length,
      generalQuestions: trainingData.filter(d => d.shouldRespond && d.classifierSays === 'general-question').length
    };
    
    message.reply(`
**📊 Training Statistics**
━━━━━━━━━━━━━━━━━━━━
✅ Should Respond: **${stats.shouldRespond}**
❌ Should Ignore: **${stats.shouldIgnore}**
🎮 Server Questions: **${stats.serverQuestions}**
🌐 General Questions: **${stats.generalQuestions}**
📝 Total Examples: **${stats.total}**

Classifier Accuracy: **${stats.total > 0 ? ((stats.shouldRespond / stats.total) * 100).toFixed(1) : 0}%** of labeled messages should get responses
    `);
  }
  
  if (content === '!export') {
    message.reply({
      content: '📦 Here\'s your training data:',
      files: [{
        attachment: TRAINING_DATA_FILE,
        name: 'training-data.json'
      }]
    });
  }
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isButton()) return;
  if (interaction.channel.id !== TRAINING_CHANNEL_ID) return;
  
  const currentMessage = messagesToClassify[currentIndex];
  
  if (interaction.customId === 'train_yes') {
    trainingData.push({
      message: currentMessage.content,
      shouldRespond: true,
      classifierSays: currentMessage.classifierSays,
      timestamp: new Date().toISOString()
    });
    
    await interaction.update({ 
      content: '✅ Marked as: **Should Respond**', 
      embeds: [], 
      components: [] 
    });
    
    currentIndex++;
  } 
  else if (interaction.customId === 'train_no') {
    trainingData.push({
      message: currentMessage.content,
      shouldRespond: false,
      classifierSays: currentMessage.classifierSays,
      timestamp: new Date().toISOString()
    });
    
    await interaction.update({ 
      content: '❌ Marked as: **Should Ignore**', 
      embeds: [], 
      components: [] 
    });
    
    currentIndex++;
  } 
  else if (interaction.customId === 'train_skip') {
    await interaction.update({ 
      content: '⏭️ Skipped', 
      embeds: [], 
      components: [] 
    });
    
    currentIndex++;
  } 
  else if (interaction.customId === 'train_stop') {
    await interaction.update({ 
      content: '⏹️ Training stopped!', 
      embeds: [], 
      components: [] 
    });
    
    saveTrainingData();
    trainingInProgress = false;
    
    const stats = {
      total: trainingData.length,
      shouldRespond: trainingData.filter(d => d.shouldRespond).length,
      shouldIgnore: trainingData.filter(d => !d.shouldRespond).length
    };
    
    interaction.channel.send(`
**✅ Training Session Complete!**
━━━━━━━━━━━━━━━━━━━━
Reviewed: **${currentIndex}/${messagesToClassify.length}** messages
Total training data: **${stats.total}** examples
✅ Should Respond: **${stats.shouldRespond}**
❌ Should Ignore: **${stats.shouldIgnore}**

Data saved to \`training-data.json\`
Use \`!stats\` to view detailed statistics
Use \`!export\` to download the training data
    `);
    
    return;
  }
  
  // Save after every 10 responses
  if (trainingData.length % 10 === 0) {
    saveTrainingData();
  }
  
  // Check if we're done
  if (currentIndex >= messagesToClassify.length) {
    saveTrainingData();
    trainingInProgress = false;
    
    const stats = {
      total: trainingData.length,
      shouldRespond: trainingData.filter(d => d.shouldRespond).length,
      shouldIgnore: trainingData.filter(d => !d.shouldIgnore).length
    };
    
    interaction.channel.send(`
**🎉 All Messages Reviewed!**
━━━━━━━━━━━━━━━━━━━━
Total training data: **${stats.total}** examples
✅ Should Respond: **${stats.shouldRespond}**
❌ Should Ignore: **${stats.shouldIgnore}**

Data saved to \`training-data.json\`
Run \`!train\` again to review more messages
    `);
    
    return;
  }
  
  // Show next message
  setTimeout(() => askAboutMessage(interaction.channel, messagesToClassify[currentIndex]), 500);
});

client.on('error', (error) => {
  console.error('Discord client error:', error);
});

client.login(process.env.DISCORD_TOKEN).catch((error) => {
  console.error('Failed to login:', error);
  process.exit(1);
});
