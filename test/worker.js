const { runAsWorker } = require('../lib')

runAsWorker(result => Promise.resolve(result))
