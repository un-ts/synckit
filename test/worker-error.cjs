const { runAsWorker } = require('../lib/index.cjs')

runAsWorker(() => Promise.reject(new Error('Worker Error')))
