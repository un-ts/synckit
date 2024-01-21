const { makeSynchronized } = require('make-synchronized')

/** @type {() => string} */
const syncFn = makeSynchronized(require.resolve('./native.cjs'))

module.exports = syncFn
