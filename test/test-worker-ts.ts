import { Worker, MessageChannel, receiveMessageOnPort } from 'worker_threads'

import { WorkerToMainMessage } from 'synckit'

const sharedBuffer = new SharedArrayBuffer(1024)
const sharedBufferView = new Int32Array(sharedBuffer)

const { port1: mainPort, port2: workerPort } = new MessageChannel()

const worker = new Worker(
  `require('ts-node/register');require(require('worker_threads').workerData.workerPath)`,
  {
    eval: true,
    transferList: [workerPort],
    workerData: {
      workerPath: require.resolve('./worker-ts'),
      workerPort,
    },
    execArgv: [],
  },
)

const msg = { sharedBuffer, id: 0, args: ['Hello World!'] }
worker.postMessage(msg)

worker.unref()

const status = Atomics.wait(sharedBufferView, 0, 0)

console.log(status)

const message = receiveMessageOnPort(mainPort)!.message as WorkerToMainMessage

console.log('message:', message)
