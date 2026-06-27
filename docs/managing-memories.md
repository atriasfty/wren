# How to Manage and Delete Memories

One of Wren's most powerful features is **Proactive Memory**. Wren actively learns about your community by listening to conversations, remembering user preferences, and saving important context for later.

However, sometimes Wren might remember something incorrect, or a user might intentionally try to feed Wren false information. As a server administrator or staff member, you have full control over what Wren remembers.

---

## Types of Memory

Wren stores memory in two different scopes:

1. **User Memory:** Things Wren remembers about a specific person (e.g., "John's favorite car is the Mustang"). Wren will only use this memory when talking to John.
2. **Server Memory:** Things Wren remembers about the server as a whole (e.g., "The server is hosting a special event this Friday"). Wren will use this memory when talking to *anyone* in the server.

---

## Viewing Stored Memories

To see everything Wren has memorized in your server, type:
```
/wren memory list
```
*(You must have Staff permissions or higher to run this).*

The bot will output a list of memories. Each memory will look something like this:
`[#45 server] The police department applications open on Friday.`
`[#46 user /discord:12345] User prefers to be called 'Captain'.`

Take note of the **ID number** (e.g., `#45`), as you will need it to delete the memory.

---

## Deleting a Memory

If you spot a memory that is incorrect, outdated, or malicious, you can delete it immediately. 

Type the following command, replacing the ID with the number from the list:
```
/wren memory remove id:45
```
Wren will permanently forget that piece of information.

---

## Manually Adding a Memory

You don't have to wait for Wren to learn things on its own. You can explicitly force Wren to remember something using the add command.

To add a memory about a specific user:
```
/wren memory add scope:user target:@username content:This user is the head of the EMS department.
```

To add a memory for the whole server (Requires Server Owner):
```
/wren memory add scope:server content:The server IP address changed to 192.168.1.1.
```

*Warning: Server-scoped memories are highly influential on Wren's behavior. Only the Server Owner can manually add them to prevent staff abuse.*
