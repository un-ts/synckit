// we're not using `synckit` here because jest can not handle cjs+mjs dual package correctly
const { runAsWorker } = require('../lib/index.cjs')

runAsWorker(
  (result, timeout) =>
    new Promise(resolve => setTimeout(() => resolve(result), timeout)),
)
