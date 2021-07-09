import { runAsWorker } from 'synckit'

// eslint-disable-next-line @typescript-eslint/no-floating-promises
runAsWorker(<T>(result: T) => Promise.resolve(result))
