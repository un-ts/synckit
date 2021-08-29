const fs = require('fs')

const deasync = require('deasync')

const readFile = deasync(fs.readFile)

module.exports = filename => readFile(filename, 'utf8')
