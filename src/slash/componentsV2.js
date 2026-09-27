// Discord Components V2 message helpers. V2 messages must use components only:
// traditional `content` and `embeds` are not accepted alongside the flag.
export const IS_COMPONENTS_V2 = 1 << 15;
const TEXT_DISPLAY = 10;
const SEPARATOR = 14;
const CONTAINER = 17;

function asText(value) {
  return { type: TEXT_DISPLAY, content: String(value ?? '') };
}

export function v2Message({ title, description = '', fields = [], components = [], color = 0x0bb0d1, ephemeral = true, content = '' } = {}) {
  const body = [];
  if (title) body.push(asText(`## ${title}`));
  if (content) body.push(asText(content));
  if (description) body.push(asText(description));
  for (const field of fields) {
    body.push({ type: SEPARATOR, divider: true, spacing: 1 });
    body.push(asText(`**${field.name}**\n${field.value}`));
  }
  if (components.length) {
    if (body.length) body.push({ type: SEPARATOR, divider: true, spacing: 1 });
    body.push(...components.map((component) => component?.toJSON ? component.toJSON() : component));
  }
  // A container makes the whole response read as one intentional Wren panel.
  const container = { type: CONTAINER, accent_color: color, components: body.length ? body : [asText('Wren')] };
  return { flags: IS_COMPONENTS_V2, components: [container], ...(ephemeral ? { ephemeral: true } : {}) };
}

export function v2FromEmbed(embed, components = [], options = {}) {
  const data = embed?.toJSON ? embed.toJSON() : embed || {};
  return v2Message({
    title: data.title,
    description: data.description,
    fields: data.fields || [],
    color: data.color ?? options.color,
    components,
    ...options,
  });
}

export function v2Text(text, { title, color, ephemeral = true, components = [] } = {}) {
  return v2Message({ title, description: String(text ?? ''), color, ephemeral, components });
}
