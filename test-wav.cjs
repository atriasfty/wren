const { WaveFile } = require('wavefile');
const pcmBuffer = Buffer.alloc(32000); // 1 second of silence
const samples = new Int16Array(pcmBuffer.buffer, pcmBuffer.byteOffset, pcmBuffer.length / 2);
const wav = new WaveFile();
wav.fromScratch(1, 16000, '16', samples);
console.log('WAV header size:', wav.toBuffer().length);
