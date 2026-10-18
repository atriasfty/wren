// The model ↔ tool loop, shared by the production pipeline and WrenBench.
//
// Everything environment-specific is injected: `complete` performs one chat
// completion (the pipeline wraps it with tracing/metrics, the bench with a
// call budget), and `runTool` executes a tool call (the real executor in
// production, a fake ERLC world in the bench).

export const MAX_TOOL_STEPS = 8;
export const MAX_VIEWED_IMAGES = 3;
export const MAX_GENERATED_IMAGES = 2;
export const MAX_REPLY_IMAGES = 4; // generated + web images combined

function contentText(content) {
  return typeof content === 'string' ? content : (content?.[0]?.text || '');
}

// Mutates `messages` (appends assistant/tool turns). Errors from a regular
// step propagate to the caller; only the forced-final call is best-effort.
// Returns { text, noChoice, trace } where trace is one entry per tool call.
export async function runModelLoop({
  complete,
  runTool,
  model,
  messages,
  tools,
  temperature = 0.2,
  maxSteps = MAX_TOOL_STEPS,
  onToolStep = null,
  generatedImages = [],
}) {
  const trace = [];
  let generatedCount = 0;
  let finalText = '';

  for (let step = 0; step < maxSteps; step++) {
    const resp = await complete({ model, messages, tools, tool_choice: 'auto', temperature });

    const choice = resp.choices?.[0];
    if (!choice) return { text: 'No response from model.', noChoice: true, trace, generatedImages };

    const msg = choice.message;
    const toolCalls = msg.tool_calls || [];

    if (toolCalls.length === 0) {
      finalText = contentText(msg.content);
      break;
    }

    // Set content to null (not empty string) when tool_calls are present
    const assistantContent = msg.content == null || msg.content === '' ? null : msg.content;
    messages.push({ role: 'assistant', content: assistantContent, tool_calls: toolCalls });

    if (onToolStep) {
      try { await onToolStep(assistantContent); } catch (e) { console.warn('[loop] onToolStep failed:', e.message); }
    }

    const toolResults = [];
    const viewedImages = [];
    for (const tc of toolCalls) {
      const name = tc.function?.name;
      let args = {};
      let malformedArgs = false;
      try { args = tc.function?.arguments ? JSON.parse(tc.function.arguments) : {}; } catch { malformedArgs = true; }

      // Don't run a tool on arguments we couldn't parse: running it with {}
      // can "succeed" vacuously (e.g. pm_all_staff with no message) and the
      // model would then report an action that never happened.
      // Refuse before running, not after: generate_image spends the user's
      // weekly allowance, so a call whose image would be dropped must not run.
      const imageCapHit = (name === 'generate_image' && generatedCount >= MAX_GENERATED_IMAGES) ||
        ((name === 'generate_image' || name === 'find_images') && generatedImages.length >= MAX_REPLY_IMAGES);
      let result = malformedArgs
        ? { success: false, error: 'Tool arguments were not valid JSON; nothing was executed. Retry with valid arguments.' }
        : imageCapHit
          ? { success: false, error: `Image limit for one reply reached (${MAX_GENERATED_IMAGES} generated, ${MAX_REPLY_IMAGES} total).` }
          : await runTool(name, args);

      // view_image hands back a URL; pull it out so only text goes in the tool
      // result and the pixels arrive as a user turn below.
      if (result?.imageUrl) {
        const { imageUrl, ...rest } = result;
        if (viewedImages.length < MAX_VIEWED_IMAGES) {
          viewedImages.push({ id: result.image_id, url: imageUrl });
        } else {
          rest.success = false;
          rest.error = `At most ${MAX_VIEWED_IMAGES} images can be viewed per reply.`;
        }
        result = rest;
      }

      // generate_image hands back the bytes; keep them out of the tool result
      // text and collect them to attach to the final reply.
      if (result?.generatedImage) {
        const { generatedImage, ...rest } = result;
        generatedImages.push(generatedImage);
        generatedCount++;
        result = rest;
      }
      // find_images hands back downloaded web images the same way.
      if (result?.attachedImages) {
        const { attachedImages, ...rest } = result;
        generatedImages.push(...attachedImages.slice(0, MAX_REPLY_IMAGES - generatedImages.length));
        result = rest;
      }

      trace.push({ step, name, args, malformedArgs, result });
      toolResults.push({
        tool_call_id: tc.id,
        role: 'tool',
        name,
        content: JSON.stringify(result),
      });
    }

    messages.push(...toolResults);
    // Tool messages must stay contiguous after the assistant's tool_calls, so
    // the requested images go in a user turn after all of them.
    for (const v of viewedImages) {
      messages.push({
        role: 'user',
        content: [
          { type: 'text', text: `[Image id=${v.id}, requested via view_image. Shown for this reply only.]` },
          { type: 'image_url', image_url: { url: v.url } },
        ],
      });
    }
  }

  let forcedFinal = false;
  if (!finalText) {
    // Ran out of tool steps mid-research. Force one more call with no tool
    // access so the model summarizes whatever it already gathered instead of
    // leaving the user with a dead-end reply. The `tools` array is omitted
    // entirely rather than relying on tool_choice:'none' — some providers
    // (seen with deepseek via OpenRouter) still emit a tool_calls-only,
    // content-less message even when told not to call tools, so the only
    // reliable way to force text is to not expose any tools at all.
    forcedFinal = true;
    try {
      const resp = await complete({ model, messages, temperature });
      finalText = contentText(resp.choices?.[0]?.message?.content);
    } catch (err) {
      // Some providers reject a history containing tool calls when no tools
      // are declared; fall back to declaring them with tool_choice 'none'.
      console.warn('[loop] forced final reply without tools failed, retrying with tool_choice none:', err.message);
      try {
        const resp = await complete({ model, messages, tools, tool_choice: 'none', temperature });
        finalText = contentText(resp.choices?.[0]?.message?.content);
      } catch (err2) {
        console.error('[loop] forced final reply failed:', err2);
      }
    }
  }

  return { text: finalText, forcedFinal, trace, generatedImages };
}
