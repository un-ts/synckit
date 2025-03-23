import { runAsWorker } from 'synckit'

runAsWorker(
  (result, timeout = result) =>
    new Promise(resolve =>
      setTimeout(() => {
        console.log('Worker:', result)
        return resolve(result)
      }, timeout),
    ),
)
