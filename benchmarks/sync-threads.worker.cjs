const fs = require('node:fs')

const { runAsWorker } = require('sync-threads')

runAsWorker(filename => fs.promises.readFile(filename, 'utf8'))
