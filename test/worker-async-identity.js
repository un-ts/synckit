import { runAsWorker } from 'synckit'

runAsWorker(value => Promise.resolve(value))
