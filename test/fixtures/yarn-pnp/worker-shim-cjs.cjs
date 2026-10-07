const { runAsWorker } = require('synckit')

runAsWorker(() => typeof globalThis.__shimProbe)
