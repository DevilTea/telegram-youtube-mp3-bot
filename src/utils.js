// Copyright (c) 2020 DevilTea
//
// This software is released under the MIT License.
// https://opensource.org/licenses/MIT
const fs = require('fs')

module.exports = {
  async exists (path) {
    return fs.promises.access(path, fs.constants.F_OK)
      .then(() => true)
      .catch(_ => false)
  },

  getTimemarkSeconds (timemark) {
    const [hour, minute, second] = timemark.split('.').shift().split(':')
    return parseInt(hour) * 3600 + parseInt(minute) * 60 + parseInt(second)
  }
}
