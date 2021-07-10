const { createSyncFn } = require('../lib')

/**
 * @type {() => string}
 */
const syncFn = createSyncFn(require.resolve('./synckit.worker'))

module.exports = syncFn
