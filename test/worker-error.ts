import { runAsWorker } from 'synckit'

// eslint-disable-next-line @typescript-eslint/no-floating-promises
runAsWorker(() => Promise.reject(new Error('Worker Error')))
