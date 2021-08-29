const fs = require('fs')

module.exports = filename => fs.readFileSync(filename, 'utf8')
