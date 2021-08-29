const { runAsWorker } = require('../lib/index.cjs')

runAsWorker(
  (result, timeout) =>
    new Promise(resolve => setTimeout(() => resolve(result), timeout)),
)
