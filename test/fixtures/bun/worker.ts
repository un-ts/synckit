import { runAsWorker } from 'synckit'

runAsWorker(
  (result: number, timeout: number = result) =>
    new Promise<number>(resolve => setTimeout(() => resolve(result), timeout)),
)
