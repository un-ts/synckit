import { runAsWorker } from 'synckit'

runAsWorker(
  (result, timeout = result) =>
    new Promise(resolve => setTimeout(() => resolve(result), timeout)),
)
