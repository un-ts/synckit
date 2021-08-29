const { runAsWorker } = require('synckit')

runAsWorker(() => Promise.reject(new Error('Worker Error')))
