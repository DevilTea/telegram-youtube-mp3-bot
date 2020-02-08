// Copyright (c) 2020 DevilTea
//
// This software is released under the MIT License.
// https://opensource.org/licenses/MIT
const fs = require('fs')
const path = require('path')
const ytdl = require('ytdl-core')
const ffmpeg = require('fluent-ffmpeg')
const EventEmitter = require('events')
const { defaultBitrate, defaultDownloadPath } = require('../config.json')
const { exists, getTimemarkSeconds } = require('./utils')

const BASE_DOWNLOAD_PATH = path.resolve(defaultDownloadPath)
// Telegram sendAudio limitation
const MAX_FILE_SIZE_KB = 20000

const DownloadTaskStatus = {
  UNSTARTED: 0,
  STARTED: 1,
  FINISHED: 2,
  CANCELED: 3,
  ERROR: 4
}

class DownloadTask {
  constructor () {
    this.info = null
    this.bitrate = null
    this.status = DownloadTaskStatus.UNSTARTED
    this.downloadPath = BASE_DOWNLOAD_PATH
    this._emitter = new EventEmitter()
    this._cancel = () => {
      console.warn('task is unstarted')
    }
  }

  get maxSecondOfAudioLength () {
    return MAX_FILE_SIZE_KB / (this.bitrate / 8)
  }

  get paths () {
    const { vid } = this.info
    const folder = path.join(this.downloadPath, `${vid}/${this.bitrate}`)
    const audio = path.join(folder, 'audio.mp3')
    return {
      folder,
      audio
    }
  }

  static async create (vid, bitrate = defaultBitrate, downloadPath = '.') {
    const task = new DownloadTask()
    task.info = await task._getYouTubeVideoInfo(vid)
    task.bitrate = bitrate
    if (parseInt(task.info.lengthSeconds) > task.maxSecondOfAudioLength) {
      const error = new Error('TOO_LONG')
      error.info = {
        bitrate: task.bitrate,
        maxSecondOfAudioLength: task.maxSecondOfAudioLength
      }
      throw error
    }
    task.downloadPath = path.join(task.downloadPath, downloadPath)
    return task
  }

  on (event, listener) {
    this._emitter.on(event, listener)
    return this
  }

  start () {
    if (this.status !== DownloadTaskStatus.UNSTARTED) {
      console.warn('task is started')
      return this
    }

    this.status = DownloadTaskStatus.STARTED

    const exec = async () => {
      const { folder } = this.paths
      if (!await exists(folder)) {
        await fs.promises.mkdir(folder, {
          recursive: true
        })
      }

      await this._saveAudio()
      this._changeStatus(DownloadTaskStatus.FINISHED)
    }
    exec()
      .catch(error => {
        if (error.message === 'CANCELED') {
          this._changeStatus(DownloadTaskStatus.CANCELED)
        } else {
          this._emitter.emit('error', error)
        }
      })
    return this
  }

  cancel () {
    if (this.status !== DownloadTaskStatus.STARTED) {
      // console.warn('task is not started')
      return
    }
    this._cancel()
    return this
  }

  _changeStatus (newStatus, ...args) {
    this.status = newStatus
    switch (newStatus) {
      case DownloadTaskStatus.STARTED:
        this._emitter.emit('start')
        break
      case DownloadTaskStatus.FINISHED:
        this._emitter.emit('finish')
        break
      case DownloadTaskStatus.CANCELED:
        this._emitter.emit('cancel')
        break
    }
  }

  async _getYouTubeVideoInfo (_vid) {
    const { video_id: vid, title, length_seconds: lengthSeconds } = await ytdl.getBasicInfo(_vid)
      .catch(_ => {
        throw new Error('NOT_FOUND')
      })

    return {
      vid,
      title,
      lengthSeconds
    }
  }

  _saveAudio () {
    return new Promise((resolve, reject) => {
      const { vid, lengthSeconds } = this.info
      const { folder, audio } = this.paths

      exists(audio)
        .then(existed => {
          if (existed) {
            resolve(fs.createReadStream(audio))
          } else {
            const stream = ytdl(vid, {
              quality: 'highestaudio',
              filter: 'audioonly'
            })

            const command = ffmpeg(stream)
              .audioBitrate(this.bitrate)
              .on('progress', ({ timemark }) => {
                const percent = Math.floor(getTimemarkSeconds(timemark) * 100 / lengthSeconds)
                this._emitter.emit('progress', `${percent}%`)
              })
              .on('end', () => {
                resolve()
              })
              .on('error', (error) => {
                fs.promises.rmdir(folder, { recursive: true })
                if (error.message === 'ffmpeg was killed with signal SIGKILL') {
                  reject(new Error('CANCELED'))
                } else {
                  console.log(error)
                  reject(error)
                }
              })
              .save(audio)

            this._cancel = () => {
              command.kill()
            }
          }
        })
    })
  }
}

module.exports = {
  DownloadTaskStatus,
  DownloadTask
}
