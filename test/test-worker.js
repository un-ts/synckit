import { createRequire } from 'module'
import { Worker, MessageChannel, receiveMessageOnPort } from 'worker_threads'

const cjsRequire = createRequire(import.meta.url)

const sharedBuffer = new SharedArrayBuffer(1024)
const sharedBufferView = new Int32Array(sharedBuffer)

const { port1: mainPort, port2: workerPort } = new MessageChannel()

const worker = new Worker(cjsRequire.resolve('./worker'), {
  transferList: [workerPort],
  workerData: {
    workerPort,
  },
  execArgv: [],
})

const msg = { sharedBuffer, id: 0, args: ['Hello World!'] }
worker.postMessage(msg)

worker.unref()

const status = Atomics.wait(sharedBufferView, 0, 0)

console.log(status)

const message = receiveMessageOnPort(mainPort).message

console.log('message:', message)
