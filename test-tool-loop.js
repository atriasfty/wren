import dotenv from 'dotenv';
dotenv.config({ path: '.env' });
import { Mistral } from '@mistralai/mistralai';

const client = new Mistral({ apiKey: process.env.MISTRAL_API_KEY });
async function test() {
  const tools = [{
    type: 'function',
    function: { name: 'get_weather', description: 'Get weather', parameters: { type: 'object', properties: { city: { type: 'string' } } } }
  }];
  
  const messages = [{ role: 'user', content: 'What is the weather in Paris?' }];
  
  let res = await client.chat.complete({ model: 'mistral-large-latest', messages, tools });
  const msg1 = res.choices[0].message;
  console.log("Model response 1:", msg1);
  
  messages.push({ role: 'assistant', content: msg1.content || null, toolCalls: msg1.toolCalls });
  
  // mock tool execution
  const tc = msg1.toolCalls[0];
  messages.push({
    toolCallId: tc.id,
    role: 'tool',
    name: tc.function.name,
    content: JSON.stringify({ temp: 25, unit: 'C' })
  });
  
  console.log("Sending second payload...");
  res = await client.chat.complete({ model: 'mistral-large-latest', messages, tools });
  console.log("Model response 2:", res.choices[0].message);
}
test().catch(err => console.error(err.body || err));
