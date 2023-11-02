const express = require('express')
const axios = require('axios')
const ngrok = require('ngrok')
const moment = require('moment')
const nodemon = require('nodemon')
const bodyParser = require('body-parser')
const config = require('./config')
const { env } = process

// Base URL API endpoint. Do not edit!
const API_URL = env.API_URL || 'https://api.wassenger.com/v1'

// Create web server
const app = express()

// Middleware to parse incoming request bodies
app.use(bodyParser.json())

// Index route
app.get('/', (req, res) => {
  res.send({
    name: 'chatbot',
    description: 'Simple WhatsApp chatbot for Wassenger',
    endpoints: {
      webhook: {
        path: '/webhook',
        method: 'POST'
      },
      sendMessage: {
        path: '/message',
        method: 'POST'
      },
      sample: {
        path: '/sample',
        method: 'GET'
      }
    }
  })
})

// POST route to handle incoming webhook messages
app.post('/webhook', (req, res) => {
  const { body } = req
  if (!body || !body.event || !body.data) {
    return res.status(400).send({ message: 'Invalid payload body' })
  }
  if (body.event !== 'message:in:new') {
    return res.status(202).send({ message: 'Ignore webhook event: only message:in:new is accepted' })
  }

  res.send({ ok: true })

  // Process message in background
  processMessage(body).catch(err => {
    console.error('[error] failed to process inbound message:', body.id, body.data.fromNumber, body.data.body, err)
  })
})

// Send message on demand
app.post('/message', (req, res) => {
  const { body } = req
  if (!body || !body.phone || !body.message) {
    return res.status(400).send({ message: 'Invalid payload body' })
  }

  sendMessage(body).then((data) => {
    res.send(data)
  }).catch(err => {
    res.status(+err.status || 500).send(err.response ? err.response.data : {
      message: 'Failed to send message'
    })
  })
})

// Send a sample message to your own number, or to a number specified in the query string
app.get('/sample', (req, res) => {
  const { phone, message } = req.query
  const data = {
    phone: phone || app.device.phone,
    message: message || 'Hello World from Wassenger!',
    device: app.device.id
  }
  sendMessage(data).then((data) => {
    res.send(data)
  }).catch(err => {
    res.status(+err.status || 500).send(err.response ? err.response.data : {
      message: 'Failed to send sample message'
    })
  })
})

app.use((err, req, res, next) => {
  res.status(+err.status || 500).send({
    message: `Unexpected error: ${err.message}`
  })
})

// In-memory store for a simple state machine per chat
// You can use a database instead for persistence
const state = {}
const reminders = {}

// In-memory cache store
const cache = {}
const cacheTTL = 10 * 60 * 1000 // 10 min

async function pullMembers (device) {
  if (cache.members && +cache.members.time && (Date.now() - +cache.members.time) < cacheTTL) {
    return cache.members.data
  }
  const url = `${API_URL}/devices/${device.id}/team`
  const { data: members } = await axios.get(url, { headers: { Authorization: config.apiKey } })
  cache.members = { data: members, time: Date.now() }
  return members
}

async function validateMembers (device, members) {
  const validateMembers = (config.teamWhitelist || []).concat(config.teamBlacklist || [])
  for (const id of validateMembers) {
    if (typeof id !== 'string' || string.length !== 24) {
      return exit('Team user ID in config.teamWhitelist and config.teamBlacklist must be a 24 characters hexadecimal value:', id)
    }
    const exists = members.some(user => user.id === id)
    if (!exists) {
      return exit('Team user ID in config.teamWhitelist or config.teamBlacklist does not exist:', id)
    }
  }
}

async function createLabels (device) {
  const labels = cache.labels.data || []
  const requiredLabels = (config.setLabelsOnUserAssignment || []).concat(config.setLabelsOnBotChats || [])
  const missingLabels = requiredLabels.filter(label => labels.every(l => l.name !== label))
  for (const label of missingLabels) {
    console.log('[info] creating missing label:', label)
    const url = `${API_URL}/devices/${device.id}/labels`
    const body = {
      name: label.slice(0, 30).trim(),
      color: [
        'tomato', 'orange', 'sunflower', 'bubble',
        'rose', 'poppy', 'rouge', 'raspberry',
        'purple', 'lavender', 'violet', 'pool',
        'emerald', 'kelly', 'apple', 'turquoise',
        'aqua', 'gold', 'latte', 'cocoa'
      ][Math.floor(Math.random() * 20)],
      description: 'Automatically created label for the chatbot'
    }
    try {
      await axios.post(url, body, { headers: { Authorization: config.apiKey } })
    } catch (err) {
      console.error('[error] failed to create label:', label, err.message)
    }
  }
  if (missingLabels.length) {
    await pullLabels(device, { force: true })
  }
}

async function pullLabels (device, { force } = {}) {
  if (!force && cache.labels && +cache.labels.time && (Date.now() - +cache.labels.time) < cacheTTL) {
    return cache.labels.data
  }
  const url = `${API_URL}/devices/${device.id}/labels`
  const { data: labels } = await axios.get(url, { headers: { Authorization: config.apiKey } })
  cache.labels = { data: labels, time: Date.now() }
  return labels
}

async function updateChatLabels ({ data, device, labels }) {
  const url = `${API_URL}/chat/${device.id}/chats/${data.chat.id}/labels`
  const newLabels = (data.chat.labels || [])
  for (const label of labels) {
    if (newLabels.includes(label)) {
      newLabels.push(label)
    }
  }
  if (newLabels.length) {
    console.log('[info] update chat labels:', data.chat.id, newLabels)
    await axios.patch(url, newLabels, { headers: { Authorization: config.apiKey } })
  }
}

async function updateChatMetadata ({ data, device, metadata }) {
  const url = `${API_URL}/chat/${device.id}/contacts/${data.chat.id}/metadata`
  const entries = []
  const contactMetadata = data.chat.contact.metadata
  for (const entry of metadata) {
    if (entry && entry.key && entry.value) {
      const value = typeof entry.value === 'function' ? entry.value() : value
      if (!entry.key || !value || typeof entry.key !== 'string' || typeof value !== 'string') {
        continue
      }
      if (contactMetadata && contactMetadata.some(e => e.key === entry.key && e.value === value)) {
        continue // skip if metadata entry is already present
      }
      entries.push({
        key: entry.key.slice(0, 30).trim(),
        value: value.slice(0, 1000).trim()
      })
    }
  }
  if (entries.length) {
    await axios.patch(url, entries, { headers: { Authorization: config.apiKey } })
  }
}

async function selectAssignMember (device) {
  const members = await pullMembers(device)

  const isMemberEligible = (member) => {
    if (config.teamBlacklist.length && config.teamBlacklist.includes(member.id)) {
      return false
    }
    if (config.teamWhitelist.length && !config.teamWhitelist.includes(member.id)) {
      return false
    }
    if (config.assignOnlyToOnlineMembers && (member.availability.mode !== 'auto' || ((Date.now() - +new Date(member.lastSeenAt)) > 30 * 60 * 1000))) {
      return false
    }
    if (config.skipTeamRolesFromAssignment && config.skipTeamRolesFromAssignment.some(role => member.role === role)) {
      return false
    }
    return true
  }

  const activeMembers = members.filter(member => member.status === 'active' && isMemberEligible(member))
  if (!activeMembers.length) {
    return console.log('[warning] Unable to assign chat: no eligible team members')
  }

  const targetMember = activeMembers[activeMembers.length * Math.random() | 0]
  return targetMember
}

async function assignChat ({ member, data, device }) {
  const url = `${API_URL}/chat/${device.id}/chats/${data.chat.id}/owner`
  const body = { agent: member.id }
  await axios.patch(url, body, { headers: { Authorization: config.apiKey } })

  if (config.setMetadataOnAssignment && config.setMetadataOnAssignment.length) {
    const metadata = config.setMetadataOnAssignment.filter(entry => entry && entry.key && entry.value).map(({ key, value }) => ({ key, value }))
    await updateChatMetadata({ data, device, metadata })
  }
}

async function assignChatToAgent ({ data, device }) {
  if (!config.enableMemberChatAssignment) {
    return console.log('[debug] Unable to assign chat: member chat assignment is disabled. Enable it in config.enableMemberChatAssignment = true')
  }
  try {
    const member = await selectAssignMember(device)
    if (member) {
      let updateLabels = []

      // Remove labels before chat assigned, if required
      if (config.removeLabelsAfterAssignment && config.setLabelsOnBotChats && config.setLabelsOnBotChats.length) {
        const labels = (data.chat.labels || []).filter(label => !config.setLabelsOnBotChats.includes(label))
        console.log('[info] remove labels before assiging chat to user', data.chat.id, labels)
        if (labels.length) {
          updateLabels = labels
        }
      }

      // Set labels on chat assignment, if required
      if (config.setLabelsOnUserAssignment && config.setLabelsOnUserAssignment.length) {
        let labels = (data.chat.labels || [])
        if (updateLabels.length) {
          labels = labels.filter(label => !updateLabels.includes(label))
        }
        for (const label of config.setLabelsOnUserAssignment) {
          if (!updateLabels.includes(label)) {
            updateLabels.push(label)
          }
        }
      }

      if (updateLabels.length) {
        console.log('[info] set labels on chat assignment to user', data.chat.id, updateLabels)
        await updateChatLabels({ data, device, labels: updateLabels })
      }

      console.log('[info] automatically assign chat to user:', data.chat.id, member.displayName, member.email)
      await assignChat({ member, data, device })
    } else {
      console.log('[info] Unable to assign chat: no eligible or available team members based on the current configuration:', data.chat.id)
    }
    return member
  } catch (err) {
    console.error('[error] failed to assign chat:', data.id, data.chat.id, err)
  }
}

async function unassignChat ({ data, device }) {
  try {
    const url = `${API_URL}/chat/${device.id}/chats/${data.chat.id}/owner`
    await axios.delete(url, null, { headers: { Authorization: config.apiKey } })
  } catch (err) {
    console.error('[error] failed to unassign chat:', data.id, data.chat.id, err)
  }
}

function canReply ({ data, device }) {
  const { chat } = data

  // Skip if chat is already assigned to an team member
  if (chat.owner && chat.owner.agent) {
    return false
  }

  // Ignore messages from group chats
  if (chat.type !== 'chat') {
    return false
  }

  // Skip replying chat if it has one of the configured labels, when applicable
  if (config.skipChatWithLabels && config.skipChatWithLabels.length && chat.labels && chat.labels.length) {
    if (config.skipChatWithLabels.some(label => chat.labels.includes(label))) {
      return false
    }
  }

  // Only reply to chats that were whitelisted, when applicable
  if (config.numbersWhitelist && config.numbersWhitelist.length && chat.fromNumber) {
    if (config.numbersWhitelist.some(number => number === chat.fromNumber || chat.fromNumber.slice(1) === number)) {
      return true
    } else {
      return false
    }
  }

  // Skip replying to chats that were explicitly blacklisted, when applicable
  if (config.numbersBlacklist && config.numbersBlacklist.length && chat.fromNumber) {
    if (config.numbersBlacklist.some(number => number === chat.fromNumber || chat.fromNumber.slice(1) === number)) {
      return false
    }
  }

  // Skip replying chats that were archived, when applicable
  if (config.skipArchivedChats && (chat.status === 'archived' || chat.waStatus === 'archived')) {
    return false
  }

  // Always ignore replying to banned chats/contacts
  if ((chat.status === 'banned' || chat.waStatus === 'banned  ')) {
    return false
  }

  return true
}

// Process message
async function processMessage ({ data, device } = {}) {
  // Can reply to this message?
  if (!canReply({ data, device })) {
    return console.log('[info] Skip message due to chat already assigned or not eligible to reply:', data.fromNumber, data.date, data.body)
  }

  const { chat, type, quoted } = data
  let { body } = data

  if (body) {
    body = body.trim()
  }

  // Process list response message selected item by the user
  if (type === 'list_response' && quoted.selectedId) {
    body = quoted.selectedId
  }

  const { phone } = chat.contact
  console.log('[info] New inbound message received:', chat.id, body || '<empty message>')

  const reply = async ({ message, ...params }) => {
    await sendMessage({
      phone,
      device: device.id,
      message,
      ...params
    })

    // Add bot-managed chat labels, if required
    if (config.setLabelsOnBotChats.length) {
      const labels = config.setLabelsOnBotChats.filter(label => (data.chat.labels || []).includes(label))
      if (labels.length) {
        await updateChatLabels({ data, device, labels })
      }
    }

    // Add bot-managed chat metadata, if required
    if (config.setMetadataOnBotChats.length) {
      const metadata = config.setMetadataOnBotChats.filter(entry => entry && entry.key && entry.value).map(({ key, value }) => ({ key, value }))
      await updateChatMetadata({ data, device, metadata })
    }
  }

  // First inbound message, reply with a welcome message
  if (!data.chat.lastOutboundMessageAt || data.meta.isFirstMessage) {
    const message = `${config.welcomeMessage}\n\n${config.defaultMessage}}`
    return await reply({ message })
  }

  // Return to main menu
  if (body && body.length < 10 && /help|cancel|stop|exit/i.test(body)) {
    body = null
    state[chat.id] = null
  }

  // Assign the chat to an random agent
  if (+body === 4 || /human|person|chat|talk/i.test(body)) {
    assignChatToAgent({ data, device }).catch(err => {
      console.error('[error] failed to assign chat to user:', data.chat.id, err.message)
    })
    return await reply({
      message: `This chat was assigned to a member of our support team. You will be contacted shortly.`,
    })
  }

  const status = state[chat.id]
  if (status && status.task === 'reminder-create') {
    let message = null
    if (status.step === 1 && body === 'x') {
      body = null
      state[chat.id] = null
    }

    const items = reminders[chat.id]
    if (items && items.length >= 10) {
      const message = 'You have reached the maximum number of reminders, please delete one before creating a new one.\n\nReply with *delete* to delete reminders.'
      return await reply({ message })
    }

    if (status.step === 1 && body !== 'x') {
      const options = ['1h', '2h', '24h', '2d', '7d', '14d']
      if (+body === 7) {
        // Cancel option
        state[chat.id] = null
      } else if (+body >= 1 && +body <= 6) {
        message = 'Please reply with a description for the reminder, up to 200 characters.'
        state[chat.id] = {
          task: 'reminder-create',
          time: [options[+body - 1]],
          step: 2
        }
        return await reply({ message })
      } else {
        state[chat.id] = null
        message = 'Invalid option, please reply with one of the available option number (1 to 7)'
        body = 'reminder-create'
        await reply({ message })
      }
    }

    if (status.step === 2) {
      if (!body || body.length < 4) {
        return await reply({ message: 'The reminder text is too short, please send a larger description with 5 characters or more.\n\nIf you do not want to continue, just reply with *stop*' })
      }
      if (body.length > 200) {
        return await reply({ message: 'The reminder text is too long, please send a shorter description up to 200 characters.\n\nIf you do not want to continue, just reply with *stop*' })
      }

      const time = state[chat.id].time
      state[chat.id] = null
      message = 'All good! I will send you a message when it is time 😀\n\nLet me know if I can do something else for you!'
      await reply({ message })

      const reminder = `Hi! This is a reminder for you:\n\n${body}`
      reminders[chat.id] = reminders[chat.id] || []

      const [value, unit] = [+time.slice(0, -1), time.slice(-1)]
      const date = moment().add(value, unit).toDate()
      reminders[chat.id].push({
        time,
        date,
        description: body
      })

      // Create message reminder at specific date
      await reply({ message: reminder, deliverAt: date })

      // Send confirmation to user
      return await reply({ message })
    }
  }

  if (status && status.task === 'button') {
    if (+body === 7 || /cancel|stop|exit/i.test(body)) {
      state[chat.id] = null
    } else if (+body >= 1 && +body <= 6) {
      const samples = ['image', 'location', 'image', 'audio', 'video', 'document']
      body = samples[+body - 1]
    } else {
      // In case of invalid input, send reminder create message again
      // body = 'reminder-create'
      body = null
      state[chat.id] = null
    }
  }

  if (status && status.task === 'reminder-delete') {
    if (status.step === 1 && /cancel|stop|exit/i.test(body)) {
      body = null
      state[chat.id] = null
    }

    const items = reminders[chat.id]
    if (!items || !items.length) {
      state[chat.id] = null
      return await reply({
        message: 'You do not have any reminders yet.\n\nCreate one by replying with *create* or *stop* to return to main menu.'
      })
    }

    if (status.step === 1 && +body >= 1 && +body <= 10) {
      const index = +body - 1
      const reminder = items[index]
      if (!reminder) {
        state[chat.id] = null
        return await reply({
          message: 'The selected reminder was not found.\n\nPlease select a valid reminder by replying *delete* or *stop* to return to main menu.'
        })
      }
      reminders.slice(index, 1)
      return await reply({
        message: `The following reminder was deleted successfully:\n\nDate: ${moment(reminder.date).format('DD/MM/YYYY HH:mm')}\n\nDescription: ${reminder.description}\n\nReply with *delete* to delete another reminder, *reminders* to list available reminders, or *stop* to return to main menu.`
      })
    }
  }

  if (+body === 1 || body === 'reminder-create' || /create|create reminder/i.test(body)) {
    state[chat.id] = {
      task: 'reminder-create',
      step: 1
    }
    return await reply({
      message: 'Please select when you want to be reminded',
      header: 'Task reminder',
      footer: 'Powered by Wassenger',
      buttons: [
        {
          text: '1 hour'
        },
        {
          text: '2 hours'
        },
        {
          text: '24 hours'
        },
        {
          text: '2 days'
        },
        {
          text: '7 days'
        },
        {
          text: '14 days'
        },
        {
          text: 'Cancel'
        }
      ]
    })
  }

  if (+body === 2 || body === 'reminder-list' || /list reminder|reminders/i.test(body)) {
    const items = reminders[chat.id]
    if (items && items.length) {
      const message = 'Here is a list of your reminders:\n\n' + items.map((item, index) => {
        const date = moment(item.date).format('DD/MM/YYYY HH:mm')
        return `${index + 1}. ${date} - ${item.description}`
      }).join('\n\n')
      return await reply({ message })
    } else {
      return await reply({
        message: 'You do not have any reminders yet. Create one by replying with *create* or *stop* to return to main menu.'
      })
    }
  }

  if (+body === 3 || body === 'reminder-delete' || /delete/i.test(body)) {
    const items = reminders[chat.id]
    if (!items || !items.length) {
      return await reply({
        message: 'You do not have any reminders yet. Create one by replying with *create* or *stop* to return to main menu.'
      })
    }
    const rows = items.map((item, index) => {
      const date = moment(item.date).format('DD/MM/YYYY HH:mm')
      return {
        id: `${index}`,
        title: `${index + 1}. ${date}`,
        description: item.description.slice(0, 72)
      }
    }).slice(0, 10)
    state[chat.id] = {
      task: 'reminder-delete',
      step: 1
    }
    return await sendMessage({
      list: {
        description: 'Please select one reminder to delete or reply with *stop* to cancel',
        title: 'Task reminder',
        button: 'Select one option',
        footer: 'Powered by Wassenger',
        sections: [
          {
            title: 'Active reminders',
            rows: rows
          }
        ]
      }
    })
  }

  if (/button/i.test(body)) {
    state[chat.id] = {
      task: 'button'
    }
    return await reply({
      phone,
      message: 'Select one message type',
      device: device.id,
      footer: 'You will receive a sample message',
      buttons: [
        {
          text: 'Image'
        },
        {
          text: 'Location'
        },
        {
          text: 'Image'
        },
        {
          text: 'Audio'
        },
        {
          text: 'Video'
        },
        {
          text: 'Document'
        },
        {
          text: 'Cancel'
        }
      ]
    })
  }

  if (/list/i.test(body)) {
    return await reply({
      list: {
        description: 'Select which type of vehicle you are interested in',
        button: 'Tap to select',
        title: 'Optional message _title_',
        footer: 'Optional *message* footer',
        sections: [
          {
            title: 'Select a car type',
            rows: [
              {
                title: 'Coupe',
                id: 'a1',
                description: 'This a description for coupe cars'
              },
              {
                title: 'Sports',
                id: 'a2',
                description: 'This a description for sports cars'
              },
              {
                title: 'SUV',
                id: 'a3',
                description: 'This a description for SUV cars'
              },
              {
                title: 'Minivan',
                id: 'a4',
                description: 'This a description for minivan cars'
              },
              {
                title: 'Crossover',
                id: 'a5',
                description: 'This a description for crossover cars'
              },
              {
                title: 'Wagon',
                id: 'a6',
                description: 'This a description for wagon cars'
              }
            ]
          },
          {
            title: 'Select a motorbike type',
            rows: [
              {
                title: 'Touring',
                id: 'b1',
                description: 'Designed to excel at covering long distances'
              },
              {
                title: 'Cruiser',
                id: 'b3',
                description: 'Harley-Davidsons largely define the cruiser category'
              },
              {
                title: 'Standard',
                id: 'b3',
                description: 'Motorcycle intended for use on streets and commuting'
              }
            ]
          }
        ]
      }
    })
  }

  if (/image/i.test(body)) {
    return await reply({
      message: 'This is a random image\nCheers 🥳 😀',
      media: {
        url: 'https://picsum.photos/600'
      }
    })
  }

  if (/video/i.test(body)) {
    return await reply({
      message: 'This is a sample video\nCheers 🥳 😀',
      media: {
        url: 'https://download.samplelib.com/mp4/sample-5s.mp4'
      }
    })
  }

  if (/audio/i.test(body)) {
    return await reply({
      media: {
        url: 'https://download.samplelib.com/mp3/sample-9s.mp3',
        format: 'ptt'
      }
    })
  }

  if (/location|address/i.test(body)) {
    return await reply({
      location: {
        address: '20 W 34th St., New York, NY 10001, United States'
      }
    })
  }

  if (/contact|card/i.test(body)) {
    return await reply({
      contacts: [
        {
          name: 'Thomas Anderson',
          phone: '+1234567890'
        },
        {
          name: 'John Wick',
          phone: '+1234567890'
        }
      ]
    })
  }

  if (/document|pdf/i.test(body)) {
    return await reply({
      message: 'This is a sample PDF 😀',
      media: {
        url: 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf'
      }
    })
  }

  if (/file|zip/i.test(body)) {
    return await reply({
      message: 'This is a sample ZIP file 😀',
      media: {
        url: 'https://www.learningcontainer.com/wp-content/uploads/2020/05/sample-zip-file.zip'
      }
    })
  }

  if (/excel|xls/i.test(body)) {
    return await reply({
      message: 'This is a sample Excel file 😀',
      media: {
        url: 'https://go.microsoft.com/fwlink/?LinkID=521962'
      }
    })
  }

  if (/format/i.test(body)) {
    return await reply({
      message: 'This message is formatted using _italic format_, *bold format*, ~strikethrough format~ and ```monospace format```'
    })
  }

  if (/quote|reply/i.test(body)) {
    return await reply({
      message: 'This is a quoted reply to your last message',
      quote: data.id
    })
  }

  if (/emoji/i.test(body)) {
    return await reply({
      message: 'Hello 👋 \nThis is a test message with emojis 👌 😘 😗 😙 😚 😋 😛 😝 😜 copied as text from:\nhttps://getemoji.com\n\nEmojis 👶 👧 🧒 👦  are simply unicode rich characters, so you can copy & paste them as simple text 😀 👏'
    })
  }

  if (/react/i.test(body)) {
    return await sendMessage({
      phone,
      reaction: '👍',
      device: device.id,
      reactionMessage: data.id
    })
  }

  if (/link|youtube/i.test(body)) {
    return await reply({
      message: 'Hey checkout this video: https://www.youtube.com/watch?v=dMH0bHeiRNg'
    })
  }

  if (/text/i.test(body)) {
    return await reply({
      message: 'Hello everyone, and welcome to this demo showcase of a WhatsApp chatbot! 🎉\n\nDuring this demo, you will get a glimpse of the chatbot\'s key features, which include instant customer support, interactive conversations, personalized recommendations, and seamless integration with your existing business processes. We are confident that our chatbot will not only save you time and resources but also foster stronger customer relationships and drive growth for your business.\n\nLet\'s get started! 😀'
    })
  }

  // Default to unknown command response
  const unknownCommand = `${config.unknownCommandMessage}\n\n${config.defaultMessage}`
  await reply({ message: unknownCommand })
}

// Function to send a message using the Wassenger API
async function sendMessage ({ phone, message, media, device, ...fields }) {
  const url = `${API_URL}/messages`
  const body = {
    phone,
    message,
    media,
    device,
    ...fields,
    enqueue: 'never'
  }

  let retries = 3
  while (retries) {
    retries -= 1
    try {
      const res = await axios.post(url, body, {
        headers: { Authorization: config.apiKey }
      })
      console.log('[info] Message sent:', phone, res.data.id, res.data.status)
      return res.data
    } catch (err) {
      console.error('[error] failed to send message:', phone, message || (body.list ? body.list.description : '<no message>'), err.response ? err.response.data : err)
    }
  }
  return false
}

// Find an active WhatsApp device connected to the Wassenger API
async function loadDevice () {
  const url = `${API_URL}/devices`
  const { data } = await axios.get(url, {
    headers: { Authorization: config.apiKey }
  })
  if (config.device && !config.device.includes(' ')) {
    if (/^[a-f0-9]{24}$/i.test(config.device) === false) {
      return exit('Invalid WhatsApp device ID: must be 24 characers hexadecimal value. Get the device ID here: https://app.wassenger.com/number')
    }
    return data.find(device => device.id === config.device)
  }
  return data.find(device => device.status === 'operative')
}

// Function to register a Ngrok tunnel webhook for the chatbot
// Only used in local development mode
async function registerWebhook (tunnel, device) {
  const webhookUrl = `${tunnel}/webhook`

  const url = `${API_URL}/webhooks`
  const { data: webhooks } = await axios.get(url, {
    headers: { Authorization: config.apiKey }
  })

  const findWebhook = webhook => {
    return (
      webhook.url === webhookUrl &&
      webhook.device === device.id &&
      webhook.status === 'active' &&
      webhook.events.includes('message:in:new')
    )
  }

  // If webhook already exists, return it
  const existing = webhooks.find(findWebhook)
  if (existing) {
    return existing
  }

  for (const webhook of webhooks) {
    // Delete previous ngrok webhooks
    if (webhook.url.includes('ngrok-free.app') || webhook.url.startsWith(tunnel)) {
      const url = `${API_URL}/webhooks/${webhook.id}`
      await axios.delete(url, { headers: { Authorization: config.apiKey } })
    }
  }

  await new Promise(resolve => setTimeout(resolve, 500))
  const data = {
    url: webhookUrl,
    name: 'Chatbot',
    events: ['message:in:new'],
    device: device.id
  }

  const { data: webhook } = await axios.post(url, data, {
    headers: { Authorization: config.apiKey }
  })

  return webhook
}

// Function to create a Ngrok tunnel and register the webhook dynamically
async function createTunnel () {
  let retries = 3

  while (retries) {
    retries -= 1
    try {
      const tunnel = await ngrok.connect({
        addr: config.port,
        authtoken: config.ngrokToken
      })
      console.log(`Ngrok tunnel created: ${tunnel}`)
      return tunnel
    } catch (err) {
      console.error('[error] Failed to create Ngrok tunnel:', err.message)
      await ngrok.kill()
      await new Promise(resolve => setTimeout(resolve, 1000))
    }
  }

  throw new Error('Failed to create Ngrok tunnel')
}

// Development server using nodemon to restart the bot on file changes
async function devServer () {
  const tunnel = await createTunnel()

  nodemon({
    script: 'bot.js',
    ext: 'js',
    watch: ['*.js', 'src/**/*.js'],
    exec: `WEBHOOK_URL=${tunnel} DEV=false npm run start`,
  }).on('restart', () => {
    console.log('[info] Restarting bot after changes...')
  }).on('quit', () => {
    console.log('[info] Closing bot...')
    ngrok.kill().then(() => process.exit(0))
  })
}

function exit (msg, ...args) {
  console.error('[error]', msg, ...args)
  process.exit(1)
}

// Initialize chatbot server
async function main () {
  // API key must be provided
  if (!config.apiKey || config.apiKey.length < 60) {
    return exit('Please sign up in Wassenger and obtain your API key here:\nhttps://app.wassenger.com/apikeys')
  }

  // Create dev mode server with Ngrok tunnel and nodemon
  if (env.DEV === 'true' && !config.production) {
    return devServer()
  }

  // Find a WhatsApp number connected to the Wassenger API
  const device = await loadDevice()
  if (!device) {
    return exit('No active WhatsApp numbers in your account. Please connect a WhatsApp number in your Wassenger account:\nhttps://app.wassenger.com/create')
  }
  if (device.session.status !== 'online') {
    return exit(`WhatsApp number (${device.alias}) is not online. Please make sure the WhatsApp number in your Wassenger account is properly connected:\nhttps://app.wassenger.com/${device.id}/scan`)
  }
  if (device.billing.subscription.product !== 'io') {
    return exit(`WhatsApp number plan (${device.alias}) does not support inbound messages. Please upgrade the plan here:\nhttps://app.wassenger.com/${device.id}/plan?product=io`)
  }

  // Pre-load device labels and team mebers
  const [members] = await Promise.all([
    pullMembers(device),
    pullLabels(device)
  ])

  // Create labels if they don't exist
  await createLabels(device)

  // Validate whitelisted and blacklisted members exist
  await validateMembers(members)

  app.device = device
  console.log('[info] Using WhatsApp connected number:', device.phone, device.alias, `(ID = ${device.id})`)

  // Start server
  await app.listen(config.port, () => {
    console.log(`Server listening on port ${config.port}`)
  })

  if (config.production) {
    console.log('[info] Validating webhook endpoint...')
    if (!config.webhookUrl) {
      return exit('Missing required environment variable: WEBHOOK_URL must be present in production mode')
    }
    const webhook = await registerWebhook(config.webhookUrl, device)
    if (!webhook) {
      return exit(`Missing webhook active endpoint in production mode: please create a webhook endpoint that points to the chatbot server:\nhttps://app.wassenger.com/${device.id}/webhooks`)
    }
    console.log('[info] Using webhook endpoint in production mode:', webhook.url)
  } else {
    console.log('[info] Registering webhook tunnel...')
    const tunnel = config.webhookUrl || await createTunnel()
    const webhook = await registerWebhook(tunnel, device)
    if (!webhook) {
      console.error('Failed to connect webhook. Please try again.')
      await ngrok.kill()
      return process.exit(1)
    }
  }

  console.log('[info] Chatbot server ready and waiting for messages!')
}

main().catch(err => {
  exit('Failed to start chatbot server:', err)
})
