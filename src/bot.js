const TelegramBot = require('node-telegram-bot-api')
const fs = require('fs')
const config = require('../config.json')
const { token, ownerUserId, ownerUsername, maxSizeOfTaskQueue, userIdWhiteList, defaultBitrate } = config
const { DownloadTask } = require('./download-task')

class Bot {
  constructor (token) {
    this._bot = new TelegramBot(token, {
      request: {
        timeout: 3600000
      }
    })
    this._userId = null
    this._username = null
    this._pending = {}
  }

  async startPolling () {
    await this._initInfo()
    this._startHandlingHelpRequests()
    this._startHandlingConvertRequests()
    this._startHandlingCancelRequests()
    this._startHandlingAllowUserRequests()
    this._bot.startPolling()
      .catch(error => {
        console.log(error.message)
      })
  }

  async _initInfo () {
    if (this._userId && this._username) {
      return
    }
    const info = await this._bot.getMe()
      .catch(error => {
        console.log(error.message)
      })
    this._userId = info.id
    this._username = info.username
  }

  async _sendEditableMessage (chatId, text, options) {
    let oldText = text
    const msg = await this._bot.sendMessage(chatId, text, options)
      .catch(error => {
        console.log('send editable message error')
        throw error
      })
    const { message_id: messageId } = msg
    return async (newText) => {
      if (oldText === newText) {
        return
      }
      oldText = newText
      const msg = await this._bot.editMessageText(newText, {
        chat_id: chatId,
        message_id: messageId
      })
        .catch(error => {
          console.log('update editable message error')
          throw error
        })
      return msg
    }
  }

  _startHandlingHelpRequests () {
    this._bot.onText(/\/(help)|(start)/, async msg => {
      const chatId = msg.chat.id
      const helpMessage = [
        `Hi！這裡是 @${this._username}`,
        '讓我來幫助你轉換 YouTube MP3 吧！\n',
        '只需要直接貼上 YouTube 影片連結就可以囉！',
        `目前轉換音訊取樣率為 ${defaultBitrate}kbps`,
        `欲轉換影片的長度限制為 ${20000 / (defaultBitrate / 8)}s`
      ].join('\n')
      await this._bot.sendMessage(chatId, helpMessage)
    })
  }

  _startHandlingAllowUserRequests () {
    this._bot.onText(/\/allow (\d+)/, async (msg, match) => {
      if (msg.from.id !== ownerUserId) return
      const chatId = msg.chat.id
      const toAllowUserId = match[1]
      userIdWhiteList.push(toAllowUserId)
      await fs.promises.writeFile('./config.json', JSON.stringify(config, null, 2))
      await this._bot.sendMessage(chatId, `成功新增 ${toAllowUserId}`)
    })
  }

  _startHandlingConvertRequests () {
    this._bot.onText(/^(?:https?:\/\/)?(?:www\.)?(?:youtu\.be\/|youtube(?:-nocookie)?\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))((?:\w|-){11})(?:\S+)?$/, async (msg, match) => {
      const chatId = msg.chat.id
      const requestUserId = msg.from.id
      const requestMessageId = msg.message_id
      const vid = match[1]
      if (requestUserId !== ownerUserId && !userIdWhiteList.includes(requestUserId)) {
        await this._bot.sendMessage(chatId, `你不在此機器人的使用者白名單內喔！\n有需要的話請聯絡 @${ownerUsername}`)
        return
      } else if (this._pending[chatId]) {
        await this._bot.sendMessage(chatId, '一次只能進行一個 YouTube MP3 轉換的動作喔！')
        return
      } else if (Object.keys(this._pending).length >= maxSizeOfTaskQueue) {
        await this._bot.sendMessage(chatId, '目前使用人數過多！請稍後再試')
        return
      }
      await this._handleConvertRequest(chatId, requestMessageId, vid)
    })
  }

  _startHandlingCancelRequests () {
    this._bot.onText(/\/cancel/, async msg => {
      const chatId = msg.chat.id
      if (this._pending[chatId]) {
        this._pending[chatId].cancel()
      }
    })
  }

  async _handleConvertRequest (chatId, requestMessageId, vid) {
    const updateEditableMessage = await this._sendEditableMessage(chatId, '收到你的 YouTube MP3 轉換需求！', {
      reply_to_message_id: requestMessageId
    })
    try {
      const { message_id: editableMessageId } = await updateEditableMessage('YouTube 影片解析中...')
      const task = await DownloadTask.create(vid, undefined, `${chatId}`)
      this._pending[chatId] = task
      await new Promise((resolve, reject) => {
        task
          .on('start', async () => {
            await updateEditableMessage('YouTube MP3 下載中 - 0%\n\n若要取消請使用： /cancel')
          })
          .on('finish', async () => {
            await updateEditableMessage('YouTube MP3 下載完成！')
            resolve()
          })
          .on('cancel', async () => {
            await updateEditableMessage('YouTube MP3 下載取消！')
            reject(new Error('CANCELED'))
          })
          .on('progress', async percent => {
            await updateEditableMessage(`YouTube MP3 下載中 - ${percent}\n\n若要取消請輸入： /cancel`)
          })
          .on('error', async error => {
            reject(error)
          })
          .start()
      })
      await updateEditableMessage('YouTube MP3 傳送中...')
      await this._bot.sendAudio(chatId, fs.createReadStream(task.paths.audio), {
        caption: 'YouTube MP3 轉換完成！',
        reply_to_message_id: requestMessageId
      },
      {
        filename: task.info.title
      })
      await this._bot.deleteMessage(chatId, editableMessageId)
      await fs.promises.rmdir(task.downloadPath, { recursive: true })
      delete this._pending[chatId]
    } catch (error) {
      if (error.message === 'CANCELED') {
        delete this._pending[chatId]
      } else if (error.message === 'NOT_FOUND') {
        await updateEditableMessage('轉換失敗：找不到該影片！')
      } else if (error.message === 'TOO_LONG') {
        await updateEditableMessage(`轉換失敗：影片長度過長！\n在取樣率為 ${error.info.bitrate}kbps 時，\n長度不可超過 ${error.info.maxSecondOfAudioLength}s！`)
      } else {
        console.log(error.message)
        await updateEditableMessage(`轉換失敗：未知錯誤！\n${error.message ? `\n${error.message}\n` : ''}\n請回報給 @${ownerUsername}\n\n嘗試轉換的 YouTube Video ID 為：${vid}`)
      }
    }
  }
}

module.exports = new Bot(token)
