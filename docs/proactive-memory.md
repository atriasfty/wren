# Proactive Memory

Wren is not forgetful. When you tell Wren something important about yourself, or when you outline rules for your server, Wren saves these facts in its memory. This means you don't have to repeat yourself over and over.

## How it works

When you send a message to Wren, it does a quick check to see if there is any long lasting information in your message. This could be things like:
* "I am the server owner."
* "My favorite color is green."
* "Rule 1 in this server is no spamming."

If Wren spots a fact like this, it uses a special internal tool to securely save it. The next time you ask Wren a question, it brings up those saved facts so it has all the context it needs to give you a great answer!

{% hint style="success" %}
Because Wren understands natural language, you can also just tell it to forget things. "Wren, my favorite color is actually blue now." It will handle the rest!
{% endhint %}

## Configuration

Server administrators can manage Wren's memory using the `/wren memory` command:
* Use `/wren memory list` to see all the facts Wren has saved for your server or specific users.
* Use `/wren memory add` to manually force Wren to remember something important.
* Use `/wren memory remove` to delete a memory you no longer want Wren to use.
