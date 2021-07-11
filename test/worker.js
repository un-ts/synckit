const { runAsWorker } = require('../lib')

runAsWorker(
  (result, timeout) =>
    new Promise(resolve => setTimeout(() => resolve(result), timeout)),
)
