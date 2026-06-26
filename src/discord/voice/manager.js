import {
  joinVoiceChannel,
  getVoiceConnection,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  EndBehaviorType,
} from '@discordjs/voice';
import prism from 'prism-media';
import { WaveFile } from 'wavefile';
import { env, pipeline } from '@xenova/transformers';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadConfig } from '../../config.js';
import { resolveTenantByGuildId } from '../../tenant/resolve.js';
import { runAssistantPipeline } from '../../ai/pipeline.js';
import { query } from '../../db/pool.js';
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Disable local cache for Transformers if desired, but we want caching so it only downloads once
env.cacheDir = path.join(__dirname, '..', '..', '..', '.cache', 'transformers');
env.allowLocalModels = true;

// Lazy-load the wake word model to avoid blocking boot
let wakeWordModelPromise = null;
function getWakeWordModel() {
  if (!wakeWordModelPromise) {
    console.log('[voice] Loading local wake-word model (Xenova/whisper-tiny.en)...');
    wakeWordModelPromise = pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny.en', { quantized: true });
  }
  return wakeWordModelPromise;
}

const activeGuilds = new Map();

export async function handleVoice(interaction) {
  const sub = interaction.options.getSubcommand();
  if (sub === 'join') {
    return await joinChannel(interaction);
  } else if (sub === 'leave') {
    return await leaveChannel(interaction);
  }
  return { content: 'Unknown voice command.', ephemeral: true };
}

async function joinChannel(interaction) {
  const member = interaction.member;
  if (!member || !member.voice.channel) {
    return { content: 'You must be in a voice channel to use this command.', ephemeral: true };
  }
  const channel = member.voice.channel;
  
  try {
    const connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: channel.guild.id,
      adapterCreator: channel.guild.voiceAdapterCreator,
      selfDeaf: false,
    });
    
    // Create player and state
    const player = createAudioPlayer();
    connection.subscribe(player);
    activeGuilds.set(channel.guild.id, {
      connection,
      player,
      isSpeaking: false,
      channelId: channel.id,
      guild: channel.guild
    });
    
    // Play privacy disclaimer
    await playDisclaimer(channel.guild.id, player);
    
    setupVoiceReceiver(connection, channel.guild.id, channel.id);
    
    return { content: `Joined voice channel: <#${channel.id}>. Wren is now listening! Say "Hey Wren" to activate.`, ephemeral: true };
  } catch (err) {
    console.error('[voice] Join failed:', err);
    return { content: 'Failed to join voice channel.', ephemeral: true };
  }
}

async function leaveChannel(interaction) {
  const connection = getVoiceConnection(interaction.guild.id);
  if (connection) {
    connection.destroy();
    activeGuilds.delete(interaction.guild.id);
    return { content: 'Left the voice channel.', ephemeral: true };
  }
  return { content: 'Wren is not currently in a voice channel on this server.', ephemeral: true };
}

async function playDisclaimer(guildId, player) {
  const disclaimerPath = path.join(__dirname, '..', '..', '..', 'data', 'disclaimer.mp3');
  try {
    await fs.mkdir(path.dirname(disclaimerPath), { recursive: true });
    try {
      await fs.access(disclaimerPath);
    } catch {
      // Generate disclaimer once
      console.log('[voice] Generating privacy disclaimer audio...');
      const cfg = loadConfig();
      const res = await fetch('https://openrouter.ai/api/v1/audio/speech', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${cfg.openRouterApiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'hexgrad/kokoro-82m',
          input: 'Hi, I am Wren. I am now listening to this voice channel to assist you.',
          voice: 'af_bella'
        })
      });
      if (res.ok) {
        const arrayBuffer = await res.arrayBuffer();
        await fs.writeFile(disclaimerPath, Buffer.from(arrayBuffer));
      } else {
        console.error('[voice] Failed to generate disclaimer:', await res.text());
        return;
      }
    }
    const resource = createAudioResource(disclaimerPath);
    player.play(resource);
  } catch (err) {
    console.error('[voice] Disclaimer error:', err);
  }
}

async function playCharm(player) {
  const charmPath = path.join(__dirname, '..', '..', '..', 'data', 'charm.wav');
  try {
    await fs.access(charmPath);
  } catch {
    console.log('[voice] Generating charm noise...');
    const sampleRate = 44100;
    const duration = 0.5;
    const samples = new Float64Array(sampleRate * duration);
    // C6 and E6 sine wave chime with a sharp decay envelope
    for (let i = 0; i < samples.length; i++) {
      const t = i / sampleRate;
      const envelope = Math.exp(-t * 15); // Fast decay
      const wave = (Math.sin(2 * Math.PI * 1046.50 * t) + Math.sin(2 * Math.PI * 1318.51 * t)) / 2;
      samples[i] = wave * envelope * 32767 * 0.5; // Half volume
    }
    const wav = new WaveFile();
    wav.fromScratch(1, sampleRate, '16', samples);
    await fs.mkdir(path.dirname(charmPath), { recursive: true });
    await fs.writeFile(charmPath, wav.toBuffer());
  }
  
  const resource = createAudioResource(charmPath);
  player.play(resource);
}

async function playUnconsented(player) {
  const unconsentedPath = path.join(__dirname, '..', '..', '..', 'data', 'unconsented.mp3');
  try {
    await fs.access(unconsentedPath);
  } catch {
    console.log('[voice] Generating unconsented audio...');
    const cfg = loadConfig();
    const res = await fetch('https://openrouter.ai/api/v1/audio/speech', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${cfg.openRouterApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'hexgrad/kokoro-82m',
        input: "You haven't consented to my terms of service yet. I've sent you a direct message so you can consent.",
        voice: 'af_bella'
      })
    });
    if (res.ok) {
      const arrayBuffer = await res.arrayBuffer();
      await fs.writeFile(unconsentedPath, Buffer.from(arrayBuffer));
    } else {
      console.error('[voice] Failed to generate unconsented audio:', await res.text());
      return;
    }
  }
  const resource = createAudioResource(unconsentedPath);
  player.play(resource);
}

function setupVoiceReceiver(connection, guildId, discordChannelId) {
  connection.receiver.speaking.on('start', (userId) => {
    const state = activeGuilds.get(guildId);
    if (!state || state.isSpeaking) return; // Prevent listening while Wren is talking
    
    // Subscribe to the audio stream until 1 second of silence
    const audioStream = connection.receiver.subscribe(userId, {
      end: { behavior: EndBehaviorType.AfterSilence, duration: 1000 },
    });
    
    // Discord sends 48kHz stereo Opus packets.
    // We decode to 16kHz mono PCM for Whisper compatibility.
    const opusDecoder = new prism.opus.Decoder({ rate: 16000, channels: 1, frameSize: 960 });
    const pcmChunks = [];
    
    audioStream.pipe(opusDecoder);
    
    opusDecoder.on('data', (chunk) => {
      pcmChunks.push(chunk);
    });
    
    opusDecoder.on('end', async () => {
      if (pcmChunks.length === 0) return;
      const pcmBuffer = Buffer.concat(pcmChunks);
      // Ignore extremely short audio bursts (less than 0.5s)
      if (pcmBuffer.length < 16000 * 2 * 0.5) return;
      
      try {
        await processAudio(pcmBuffer, userId, guildId, discordChannelId);
      } catch (err) {
        console.error('[voice] Audio processing failed:', err);
      }
    });
  });
}

async function processAudio(pcmBuffer, userId, guildId, discordChannelId) {
  const state = activeGuilds.get(guildId);
  if (!state) return;

  // 1. Convert PCM to Float32Array for local Xenova Whisper Tiny
  // pcmBuffer is 16-bit little endian, 16000Hz, mono.
  const float32Array = new Float32Array(pcmBuffer.length / 2);
  for (let i = 0; i < pcmBuffer.length / 2; i++) {
    const int16 = pcmBuffer.readInt16LE(i * 2);
    float32Array[i] = int16 / 32768.0;
  }

  const transcriber = await getWakeWordModel();
  const localResult = await transcriber(float32Array, { language: 'english' });
  const text = localResult.text.toLowerCase();
  
  if (!text.includes('wren') && !text.includes('ren')) {
    // Not addressed to Wren
    return;
  }
  
  // 2. We heard the wake word! Let's lock the state so Wren doesn't listen to itself.
  state.isSpeaking = true;
  console.log(`[voice] Wake word detected: "${text}" from user ${userId}`);
  
  // Check ToS Agreement
  let hasConsented = false;
  try {
    const res = await query('SELECT 1 FROM user_agreements WHERE discord_id = $1', [userId]);
    hasConsented = res.rows.length > 0;
  } catch (err) {
    console.error('[voice] ToS check error:', err);
    state.isSpeaking = false;
    return;
  }

  if (!hasConsented) {
    console.log(`[voice] User ${userId} has not consented to ToS.`);
    await playUnconsented(state.player);
    
    // Send DM
    try {
      const user = await state.guild.client.users.fetch(userId);
      const embed = new EmbedBuilder()
        .setTitle('Welcome to Wren!')
        .setDescription('Before using Wren in Voice Chat, please accept our Terms of Service and Privacy Policy. By clicking "Agree", you agree to both documents.')
        .setColor('#0099ff')
        .addFields(
          { name: 'Documentation', value: 'https://wren.atriasafety.org' },
          { name: 'Terms of Service', value: 'http://atriasfty.org/wren-tos' },
          { name: 'Privacy Policy', value: 'http://atriasfty.org/wren-privacy' }
        );
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('agree_tos')
          .setLabel('Agree')
          .setStyle(ButtonStyle.Primary)
      );
      await user.send({ embeds: [embed], components: [row] });
    } catch (dmErr) {
      console.error('[voice] Could not send ToS DM:', dmErr);
    }
    
    state.player.once(AudioPlayerStatus.Idle, () => {
      state.isSpeaking = false;
    });
    return;
  }

  // Play the charm noise
  await playCharm(state.player);

  // 3. Package PCM into a WAV file to send to OpenRouter (Groq Whisper)
  const wav = new WaveFile();
  wav.fromScratch(1, 16000, '16', pcmBuffer);
  const wavBuffer = wav.toBuffer();
  
  const cfg = loadConfig();
  
  // Prepare multipart form data manually or via FormData
  const formData = new FormData();
  formData.append('file', new Blob([wavBuffer], { type: 'audio/wav' }), 'audio.wav');
  formData.append('model', 'groq/whisper-large-v3');
  
  const sttRes = await fetch('https://openrouter.ai/api/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${cfg.openRouterApiKey}`
    },
    body: formData
  });
  
  if (!sttRes.ok) {
    console.error('[voice] STT failed:', await sttRes.text());
    state.isSpeaking = false;
    return;
  }
  
  const sttData = await sttRes.json();
  const finalTranscript = sttData.text;
  console.log(`[voice] Final Transcript: "${finalTranscript}"`);
  
  if (!finalTranscript || finalTranscript.trim() === '') {
    state.isSpeaking = false;
    return;
  }
  
  // 4. Run through Wren's Pipeline
  const tenantCtx = await resolveTenantByGuildId(guildId);
  if (!tenantCtx) {
    state.isSpeaking = false;
    return;
  }
  
  let fullMember = state.guild.members.cache.get(userId);
  if (!fullMember) {
    try {
      fullMember = await state.guild.members.fetch(userId);
    } catch (e) {
      console.warn(`[voice] Could not fetch full member for ${userId}`);
    }
  }
  
  const aiResult = await runAssistantPipeline(tenantCtx, {
    question: finalTranscript,
    channelContext: '', // We could fetch recent text channel messages if needed
    actor: { kind: 'discord', member: fullMember || { id: userId, user: { username: userId } } },
    channelId: discordChannelId,
    mode: 'voice' // Custom mode to trigger concise responses
  });
  
  if (!aiResult.text) {
    state.isSpeaking = false;
    return;
  }
  
  // 5. Generate TTS via Kokoro 82M
  const ttsRes = await fetch('https://openrouter.ai/api/v1/audio/speech', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${cfg.openRouterApiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'hexgrad/kokoro-82m',
      input: aiResult.text,
      voice: 'af_bella' // Best default voice
    })
  });
  
  if (!ttsRes.ok) {
    console.error('[voice] TTS failed:', await ttsRes.text());
    state.isSpeaking = false;
    return;
  }
  
  const audioArrayBuffer = await ttsRes.arrayBuffer();
  
  // Save to a temporary file since createAudioResource works best with files or standard streams
  const tempId = Math.random().toString(36).substring(7);
  const tempPath = path.join(__dirname, '..', '..', '..', 'data', `temp_${tempId}.mp3`);
  await fs.writeFile(tempPath, Buffer.from(audioArrayBuffer));
  
  const resource = createAudioResource(tempPath);
  state.player.play(resource);
  
  state.player.once(AudioPlayerStatus.Idle, () => {
    // Done speaking, unlock
    state.isSpeaking = false;
    fs.unlink(tempPath).catch(()=>{});
  });
}
