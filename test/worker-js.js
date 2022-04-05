import { runAsWorker } from 'synckit'

runAsWorker(
  (result, timeout) =>
    new Promise(resolve => setTimeout(() => resolve(result), timeout)),
)
