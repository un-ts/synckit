import { runAsWorker } from 'synckit'

runAsWorker(
  <T>(result: T, timeout?: number) =>
    new Promise<T>(resolve => setTimeout(() => resolve(result), timeout)),
)
