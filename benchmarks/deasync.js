const fs = require('fs')

const deasync = require('deasync')

const readFile = deasync(fs.readFile)

module.exports = () => readFile(__filename, 'utf8')
