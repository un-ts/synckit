// we're not using `synckit` here because jest can not handle cjs+mjs dual package correctly
const { runAsWorker } =
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('../../lib/index.cjs') as typeof import('synckit')

runAsWorker(
  <T>(result: T, timeout?: number) =>
    new Promise<T>(resolve => setTimeout(() => resolve(result), timeout)),
)
