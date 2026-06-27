const fs = require('fs');
const path = require('path');

async function generate() {
  console.log('Fetching TTS from OpenRouter...');
  const res = await fetch('https://openrouter.ai/api/v1/audio/speech', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer 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',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'hexgrad/kokoro-82m',
      input: 'You have not accepted my terms of service yet. Please check your direct messages to accept them before talking to me.',
      voice: 'am_fenrir',
      response_format: 'mp3'
    })
  });

  if (res.ok) {
    const arrayBuffer = await res.arrayBuffer();
    const filePath = path.join(__dirname, 'data', 'unconsented.mp3');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, Buffer.from(arrayBuffer));
    console.log('Successfully saved to', filePath);
  } else {
    console.error('Failed:', await res.text());
  }
}

generate();
