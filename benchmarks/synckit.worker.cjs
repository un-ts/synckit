const fs = require('fs')

const { runAsWorker } = require('../lib')

runAsWorker(filename => fs.promises.readFile(filename, 'utf8'))
