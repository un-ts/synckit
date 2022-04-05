import { runAsWorker } from 'synckit'

runAsWorker(
  (result: number, timeout: number) =>
    new Promise<number>(resolve => setTimeout(() => resolve(result), timeout)),
)
