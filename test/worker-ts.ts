import { runAsWorker } from 'synckit'

// eslint-disable-next-line @typescript-eslint/no-floating-promises
runAsWorker(
  <T>(result: T, timeout?: number) =>
    new Promise<T>(resolve => setTimeout(() => resolve(result), timeout)),
)
