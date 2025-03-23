import { runAsWorker } from 'synckit'

runAsWorker(
  (result: number, timeout: number = result) =>
    new Promise<number>(resolve =>
      setTimeout(() => {
        console.log('Worker:', result)
        return resolve(result)
      }, timeout),
    ),
)
