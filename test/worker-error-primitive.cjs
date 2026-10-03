const { runAsWorker } = require('../lib/index.cjs')

// the non-Error reason is the point of this fixture: it must reach the caller as it is
runAsWorker(() => Promise.reject('Worker primitive rejection')) // NOSONAR
