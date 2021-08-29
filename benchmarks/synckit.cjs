const { createSyncFn } = require('../lib/index.cjs')

/**
 * @type {() => string}
 */
const syncFn = createSyncFn(require.resolve('./synckit.worker.cjs'))

module.exports = syncFn
