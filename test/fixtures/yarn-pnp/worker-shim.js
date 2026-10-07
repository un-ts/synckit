import { runAsWorker } from 'synckit'

runAsWorker(() => typeof globalThis.__shimProbe)
