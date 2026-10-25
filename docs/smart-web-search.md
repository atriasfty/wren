# Smart Web Search

Sometimes you need to know about something that happened today, or a very specific fact that Wren hasn't learned yet. For those situations, Wren is equipped with a Smart Web Search feature!

## How it works

When Wren realizes it doesn't know the answer to your question, it turns to the internet. 

1. **Searching:** Wren uses Exa, a search API, to look up your question.
2. **Reading:** It reads through the top search results to find the most relevant information.
3. **Summarizing:** Instead of just giving you a list of links, Wren takes all that information, summarizes it, and writes a helpful, friendly reply.

{% hint style="info" %}
You can specifically ask Wren to search for things, like "Look up the weather in New York" or "Search for the latest gaming news."
{% endhint %}

This feature ensures that Wren is always up to date and can help you with almost anything!

## Showing images

If you ask Wren to show you something ("show me what the new iPhone looks like"), it can find a real image on the web and attach one or two to its reply, with the source credited. This works in text channels on every plan and uses no extra allowance beyond the normal message.

A few things worth knowing:

- Wren looks at the candidate images before sending anything. If none of them show what you asked for, it searches again (up to three times) or tells you it couldn't find a good one. It can still get it wrong sometimes, so tell it and ask again with a more specific description.
- This needs the AI model Wren runs on to understand images. Self-hosters using a text-only model will see image replies fail.
- Search results are moderated and images from known adult sites are blocked, but no filter is perfect.
- Wren downloads the image and attaches it. It doesn't store it, and the original is credited to its source page.
- It doesn't work in voice chat or in-game.
- Exa doesn't have a dedicated image search. Wren finds relevant web pages and picks the images from them, so results look more like press photos and article pictures than a general image index. Self-hosters: this uses the same `EXA_API_KEY` as web search.

## Configuration

The Smart Web Search feature works automatically out of the box! If the server is configured to allow search, Wren handles everything behind the scenes. 

However, you can guide how Wren searches by giving it context. Server administrators can use `/wren config view` to set the **Core info** (under the Behaviour tab). This tells Wren about your server's vibe and location, which helps it pull up more relevant search results for your community!
