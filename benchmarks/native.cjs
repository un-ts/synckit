const fs = require('node:fs')

module.exports = filename => fs.readFileSync(filename, 'utf8')
