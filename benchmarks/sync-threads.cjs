const { createSyncFn } = require('sync-threads')

/**
 * @type {() => string}
 */
const syncFn = createSyncFn(require.resolve('./sync-threads.worker.cjs'))

module.exports = syncFn
