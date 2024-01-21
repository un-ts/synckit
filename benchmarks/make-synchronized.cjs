const { makeSynchronized } = require('make-synchronized')

/**
 * @param {string} filename
 * @returns {() => string} syncified function
 */
const syncFn = filename =>
  makeSynchronized('node:fs/promises').readFile(filename, 'utf8')

module.exports = syncFn
