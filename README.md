## WhatsApp Chatbot Demo Tutorial 🤖 🤖

**A complete WhatsApp chatbot demo that's ready to use in minutes, easy to customize, using the [Wassenger API](https://wassenger.com).**

Get a chatbot running in minutes on your computer or server and easily adapt it to cover you own use cases.

The chatbot is able to create, edit and remove reminders, assign chats to agents when requested and reply with different sample messages as requested by users. You can easily modify the chatbot behavior and responses by adjusting the configuration file and code.

[Read the blog tutorial](https://medium.com/@wassenger/whatsapp-chatbot-tutorial-5ba2193a4513).

> 🤩 🤖 [**Wassenger is a complete WhatsApp API cloud solution. Sign up for free and get started in minutes!**](https://wassenger.com)

<a href="https://wassenger.com">
 <img src="https://wassenger.com/images/screenshots/main-chat.webp" width="100%" style="box-shadow: 0 0.5rem 1rem rgb(0 0 0 / 10%) !important"/>
</a>

### Contents

- [How it works](#how-it-works)
- [Features](#features)
- [Bot behavior](#bot-behavior)
- [Requirements](#requirements)
- [Project structure](#project-structure)
- [Installation](#installation)
- [Configuration](#configuration)
- [Customization](#customization)
- [Usage](#usage)
- [Questions](#questions)

### How it works

1. The program will validate you have access to Wassenger API and you have a least one WhatsApp number connected.
2. Creates a tunnel using Ngrok to be able to receive Webhook events on your computer (or you can use a dedicated webhook URL instead if you run the bot in a cloud server).
3. Registers the webhook endoint automatically.
4. Start listening for inbound messages received in your WhatsApp number.
5. You can start playing with the bot by sending messages to the connected WhatsApp number.

### Features

This tutorial provides a complete chatbot implementation in Node.js that does:

- Provides a fully featured chatbot in your WhatsApp number connected to Wassenger
- Replies automatically to inbound messages from users
- Allows any user to create, list and delete message reminders
- Allows any user to ask talking with a person, in which case the case will be assigned to an agent
- Sends a sample messages to the user based on their input (image, video, audio, document, location...)
- Configure the chatbot behavior easily using the [configuration file](config.js)

**Chatbot supported tasks**

- 1️⃣ Create a reminder
- 2️⃣ List reminders
- 3️⃣ Delete reminder
- 4️⃣ Chat with a person

Additionally, the chatbot can send you the following sample messages:

- Texth
- Image
- Video
- Audio
- PDF Document
- Excel document
- File
- Buttons
- List
- Location
- Contact card
- Quote message
- Emojis 🥳
- Text formatting
- Link preview
- Reaction

### Bot behavior

The bot will always reply to messages based on the following criteria:

- The chat belong to a user (group chats are always ignored)
- The chat is not assigned to any agent inside Wassenger
- The chat has not any of the blacklisted labels (see config.js)
- The chat user number has not been blacklisted (see config.js)
- The chat or contact has not been archived or blocked

### Requirements

- [Node.js](https://nodejs.org) ([download it here](https://nodejs.org/en/download))
- [WhatsApp](https://whatsapp.com) Personal or Business number
- [Wassenger](https://wassenger.com) API key ([sign up here for free](https://app.wassenger.com/register))
- [Connect your WhatsApp](https://app.wassenger.com/create) Personal or Business number to Wassenger
- [Sign up for a Ngrok free account](https://dashboard.ngrok.com/signup) to create a webhook tunnel (only if running the bot on your computer)

### Project structure

```
\
 |- bot.js -> the bot source code in a single file
 |- config.js -> configuration file to customize the bot behavior and rules
 |- package.json -> node.js package manifest required to install dependencies
 |- node_modules -> where the project dependencies will be installed, fully managed by npm
```

### Installation

If you have [git](https://git-scm.org) installed, run the following command from the Terminal:

```bash
git clone https://github.com/wassengerhq/whatsapp-chatbot-demo-tutorial.git
```

If you don't have `git`, download the files [using this link](https://github.com/wassengerhq/whatsapp-chatbot-demo-tutorial/download) and unzip it.

### Configuration

Open your favorite terminal and change directory to project folder where `package.json` is located:

```
cd ~/Downloads/chatbot-demo/
```

From that folder, install dependencies by running:
```bash
npm install
```

With your preferred code editor, edit `config.js` and enter your [Wassenger](https://wassenger.com) API key
([sign up here for free](https://app.wassenger.com/register)) and [enter the API key](https://app.wassenger.com/apikeys) at line 12th:

```js
// Required. Specify the Wassenger API key to be used
// You can obtain it here: https://app.wassenger.com/apikeys
apiKey: env.API_KEY || 'ENTER API KEY HERE',
```

If you need to run the program on your local computer, the program needs to create a tunnel using [Ngrok](https://ngrok.com) in to process webhook events for incoming WhatsApp messages.

[Sign up for a Ngrok free account](https://dashboard.ngrok.com/signup) and [obtain your auth token as explained here](https://ngrok.com/docs/agent/#authtokens). Then enter it in the line 29th:

```js
// Ngrok tunnel authentication token.
// Required if webhook URL is not provided.
// sign up for free and get one: https://ngrok.com/signup
// Learn how to obtain the auth token: https://ngrok.com/docs/agent/#authtokens
ngrokToken: env.NGROK_TOKEN || 'ENTER NGROK TOKEN HERE',
```

> If you run the program in a cloud server that is publicly accesible from the Internet, you don't need to use Ngrok. Instead, set your server URL in `config.js` > `webhookUrl` field.

### Usage

Run the bot program:
```bash
node bot
```

Run the bot program on a custom port:
```
PORT=80 node bot
```

Run the bot program for a specific Wassenger connected device:
```
DEVICE=WHATSAPP_DEVICE_ID node bot
```

Run the bot program in production mode:
```
NODE_ENV=production node bot
```

Run the bot with an existing webhook server without the Ngrok tunnel:
```bash
WEBHOOK_URL=https://bot.company.com:8080/webhook node bot
```

> Note: `https://bot.company.com:8080` must point to the bot program itself running in your server and it must be network reachable using HTTPS for secure connection.

### Customization

Open the [`config.js`](config.js) file and customize the available options.

Read the comments instructions for further instructions.

**That's it! You can now test the chatbot from another WhatsApp number**

You're welcome to adjust the code to fit your own needs. Possibilities are near endless!

### Questions

#### Can I customize the chatbot response and behavior?

For sure! The code is available for free and you can adapt it as much as you need.

You just need to have some JavaScript/Node.js knowledge, and you can always ask ChatGPT to help you write the code you need.

#### How to stop the bot from replying to certain chats?

You should simply assign the specific chats to any agent on the [Wassenger web chat](https://app.wassenger.com) or [using the API](https://app.wassenger.com/docs/#tag/Chats/operation/assignChatAgent).

Alternatively, you can set blacklisted labels in the `config.js` > `skipChatWithLabels` field, then add one or these labels to the specific chat you want to be ignored by the bot. You can assign labels to chats using the [Wassenger web chat](https://app.wassenger.com) or [using the API](https://app.wassenger.com/docs/#tag/Chats/operation/updateChatLabels).

#### Do I have to use Ngrok?

No, you don't. Ngrok is only used for development/testing purposes when running the program from your local computer. If you run the program in a cloud server, most likely you won't need Ngrok if your server can be reachable via Internet using a public domain (e.g: bot.company.com) or a public IP.

In that case, you simply need to provide your server full URL ended with `/webhook` like this when running the bot program:

```
WEBHOOK_URL=https://bot.company.com:8080/webhook node bot
```

Note: `https://bot.company.com:8080` must point to the bot program itself running in your server and it must be network reachable using HTTPS for secure connection.

#### What happens if the program fails?

Please check the error in the terminal and make sure you are running the program with enough permissions to start it in port 8080 in localhost.

#### How to avoid certain chats being replied by the bot?

By default the bot will ignore messages sent in group chats, blocked and archived chats/contacts.

Besides that, you can blacklist or whitelist specific phone numbers and chat with labels that be handled by the bot.

See `numbersBlacklist`, `numbersWhitelist`, and `skipChatWithLabels` options in `config.js` for more information.

#### Can I run this bot on my server?

Absolutely! Just deploy or transfer the program source code to your server and run the command from there.
The requirements are the same, no matter where you run the bot.
