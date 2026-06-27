import {
  joinVoiceChannel,
  getVoiceConnection,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  EndBehaviorType,
  entersState,
  VoiceConnectionStatus
} from '@discordjs/voice';
import prism from 'prism-media';
import wavefilePkg from 'wavefile';
const { WaveFile } = wavefilePkg;
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { loadConfig } from '../../config.js';
import { resolveTenantByGuildId } from '../../tenant/resolve.js';
import { runAssistantPipeline } from '../../ai/pipeline.js';
import { query } from '../../db/pool.js';
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Node.js undici fetch() does not support file:// protocol.
// We polyfill it here so onnxruntime-web can fetch local model files.
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  if (typeof url === 'string' && url.startsWith('file://')) {
    const filePath = fileURLToPath(url);
    const data = await fs.readFile(filePath);
    return new globalThis.Response(data);
  } else if (url instanceof globalThis.URL && url.protocol === 'file:') {
    const filePath = fileURLToPath(url);
    const data = await fs.readFile(filePath);
    return new globalThis.Response(data);
  }
  return originalFetch(url, options);
};

let initPromise = null;
async function getWakeWordModel() {
  if (!initPromise) {
    initPromise = (async () => {
      const keywordPath = path.join(__dirname, '..', '..', '..', 'hey_wren.onnx');
      if (!fsSync.existsSync(keywordPath)) {
        throw new Error(`Wake word model not found at ${keywordPath}. Please download it from openwakeword.com and place it in the project root.`);
      }
      
      const modelsDir = path.join(__dirname, '..', '..', '..', 'models');
      const { Model } = await import('openwakeword-js');
      
      const owwModel = new Model({
        wakewordModels: [pathToFileURL(keywordPath).href],
        melspectrogramModelPath: pathToFileURL(path.join(modelsDir, 'melspectrogram.onnx')).href,
        embeddingModelPath: pathToFileURL(path.join(modelsDir, 'embedding_model.onnx')).href,
        inferenceFramework: 'onnx',
        // onnxruntime-web may need standard paths, but it's safe to provide the path
        wasmPaths: path.join(__dirname, '..', '..', '..', 'node_modules', 'onnxruntime-web', 'dist/')
      });
      await owwModel.init();
      return owwModel;
    })();
  }
  return initPromise;
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
    
    // Wait for connection to be ready before playing anything, otherwise audio drops
    try {
      await entersState(connection, VoiceConnectionStatus.Ready, 20e3);
    } catch (e) {
      console.warn('[voice] Connection did not become Ready within 20s. Proceeding anyway.');
    }
    
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
    await fs.access(disclaimerPath);
  } catch {
    console.error('[voice] Missing disclaimer.mp3 file');
    return;
  }
  const resource = createAudioResource(disclaimerPath);
  player.play(resource);
}

async function playCharm(player) {
  const charmPath = path.join(__dirname, '..', '..', '..', 'data', 'charm.wav');
  try {
    await fs.access(charmPath);
  } catch {
    console.log('[voice] Generating charm noise...');
    const sampleRate = 44100;
    const duration = 0.8;
    const samples = new Float64Array(sampleRate * duration);
    // Whimsical arpeggio: C6, E6, G6, C7 staggered with loud volume
    for (let i = 0; i < samples.length; i++) {
      const t = i / sampleRate;
      const note1 = t >= 0 ? Math.sin(2 * Math.PI * 1046.50 * t) * Math.exp(-t * 10) : 0;
      const note2 = t >= 0.05 ? Math.sin(2 * Math.PI * 1318.51 * (t - 0.05)) * Math.exp(-(t - 0.05) * 10) : 0;
      const note3 = t >= 0.1 ? Math.sin(2 * Math.PI * 1567.98 * (t - 0.1)) * Math.exp(-(t - 0.1) * 10) : 0;
      const note4 = t >= 0.15 ? Math.sin(2 * Math.PI * 2093.00 * (t - 0.15)) * Math.exp(-(t - 0.15) * 10) : 0;
      
      const wave = (note1 + note2 + note3 + note4) / 4;
      samples[i] = wave * 32767 * 0.95; // Much louder (95% volume instead of 50%)
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
        voice: 'am_fenrir'
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
    
    // We decode to 16kHz mono PCM for Whisper compatibility. (16000 * 0.02s = 320 samples per frame)
    const opusDecoder = new prism.opus.Decoder({ rate: 16000, channels: 1, frameSize: 320 });
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

  // 1. Process PCM chunks with OpenWakeWord for wake-word detection
  const oww = await getWakeWordModel();
  const frameLength = 1280; // openwakeword-js chunk size
  
  // pcmBuffer is 16-bit little endian, 16000Hz, mono.
  const int16Array = new Int16Array(pcmBuffer.buffer, pcmBuffer.byteOffset, pcmBuffer.length / 2);
  let detected = false;
  
  for (let i = 0; i < int16Array.length - frameLength; i += frameLength) {
    const frame = int16Array.subarray(i, i + frameLength);
    const scores = await oww.predict(frame);
    
    for (const score of Object.values(scores)) {
      if (score > 0.5) {
        detected = true;
        break;
      }
    }
    if (detected) break;
  }

  if (!detected) {
    // Not addressed to Wren
    return;
  }
  
  // Clear the openwakeword internal buffers to prevent double chimes
  oww.reset();
  
  // 2. We heard the wake word! Let's lock the state so Wren doesn't listen to itself.
  state.isSpeaking = true;
  console.log(`[voice] Wake word detected: "hey wren" from user ${userId}`);
  
  // Check ToS Agreement
  let hasConsented;
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

  // 3. Package PCM into a WAV file to send to OpenRouter
  const wav = new WaveFile();
  const samples = new Int16Array(pcmBuffer.buffer, pcmBuffer.byteOffset, pcmBuffer.byteLength / 2);
  wav.fromScratch(1, 16000, '16', samples);
  const wavBytes = wav.toBuffer();
  
  const cfg = loadConfig();
  let finalTranscript;
  try {
    const payload = {
      model: 'nvidia/parakeet-tdt-0.6b-v3',
      audio: {
        data: wavBytes.toString('base64'),
        format: 'wav'
      }
    };

    const res = await fetch('https://openrouter.ai/api/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${cfg.openRouterApiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://wren.atriasafety.org',
        'X-OpenRouter-Title': 'Wren Voice Agent'
      },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      throw new Error(`OpenRouter STT failed: ${res.status} ${await res.text()}`);
    }
    const data = await res.json();
    finalTranscript = data.text;
  } catch (err) {
    console.error('[voice] STT failed:', err);
    state.isSpeaking = false;
    return;
  }
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
      voice: 'am_fenrir' // Best default voice
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
