const makeSynchronous = require('make-synchronous')

module.exports = makeSynchronous(filename => {
  const fs = require('fs')
  return fs.promises.readFile(filename, 'utf8')
})
