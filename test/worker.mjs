import { runAsWorker } from '../lib/index.js'

runAsWorker(
  (result, timeout) =>
    new Promise(resolve => setTimeout(() => resolve(result), timeout)),
)
