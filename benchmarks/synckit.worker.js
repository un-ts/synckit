const fs = require('fs')

const { runAsWorker } = require('../lib')

runAsWorker(() => fs.promises.readFile(__filename, 'utf8'))
