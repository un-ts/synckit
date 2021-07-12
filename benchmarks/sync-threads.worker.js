const fs = require('fs')

const { runAsWorker } = require('sync-threads')

runAsWorker(filename => fs.promises.readFile(filename, 'utf8'))
