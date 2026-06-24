import dotenv from 'dotenv';
dotenv.config({ path: '.env' });
import { Mistral } from '@mistralai/mistralai';
const client = new Mistral({ apiKey: process.env.MISTRAL_API_KEY });
async function run() {
  try {
    const res = await client.chat.complete({
      model: 'mistral-large-latest',
      messages: [
        { role: 'user', content: 'What is the weather in Paris?' },
        { role: 'assistant', toolCalls: [{ id: 'call_123', function: { name: 'get_weather', arguments: '{"city":"Paris"}' } }] },
        { role: 'tool', name: 'get_weather', toolCallId: 'call_123', content: 'Sunny, 25C' }
      ]
    });
    console.log("Success:", res.choices[0].message.content);
  } catch (err) {
    console.error("Error body:", err.body);
  }
}
run();
