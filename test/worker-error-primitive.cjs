const { runAsWorker } = require('../lib/index.cjs')

runAsWorker(() => Promise.reject('Worker primitive rejection'))
