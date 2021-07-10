const fs = require('fs')

const { runAsWorker } = require('sync-threads')

runAsWorker(() => fs.promises.readFile(__filename, 'utf8'))
