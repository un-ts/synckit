const fs = require('fs')

const { runAsWorker } = require('../lib/index.cjs')

runAsWorker(filename => fs.promises.readFile(filename, 'utf8'))
