# Smart Web Search

Sometimes you need to know about something that happened today, or a very specific fact that Wren hasn't learned yet. For those situations, Wren is equipped with a Smart Web Search feature!

## How it works

When Wren realizes it doesn't know the answer to your question, it turns to the internet. 

1. **Searching:** Wren uses a fast and private search engine (Brave Search) to look up your question.
2. **Reading:** It reads through the top search results to find the most relevant information.
3. **Summarizing:** Instead of just giving you a list of links, Wren takes all that information, summarizes it, and writes a helpful, friendly reply.

{% hint style="info" %}
You can specifically ask Wren to search for things, like "Look up the weather in New York" or "Search for the latest gaming news."
{% endhint %}

This feature ensures that Wren is always up to date and can help you with almost anything!

## Configuration

The Smart Web Search feature works automatically out of the box! If the server is configured to allow search, Wren handles everything behind the scenes. 

However, you can guide how Wren searches by giving it context. Server administrators can use `/wren config view` to set the **Core info** (under the Behaviour tab). This tells Wren about your server's vibe and location, which helps it pull up more relevant search results for your community!
