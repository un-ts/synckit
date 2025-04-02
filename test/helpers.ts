import path from 'node:path'
import { fileURLToPath } from 'node:url'
import WorkerThreads from 'node:worker_threads'

import { jest } from '@jest/globals'

import { type WorkerToMainMessage } from 'synckit'

export const _dirname = path.dirname(fileURLToPath(import.meta.url))

export const workerCjsTsPath = path.resolve(_dirname, 'cjs/worker-cjs.ts')
export const workerEsmTsPath = path.resolve(_dirname, 'esm/worker-esm.ts')
export const workerNoExtAsJsPath = path.resolve(_dirname, 'worker-js')
export const workerJsPath = path.resolve(_dirname, 'worker-js.js')
export const workerJsAsTsPath = path.resolve(_dirname, 'worker.js')
export const workerTsPath = path.resolve(_dirname, 'worker.ts')
export const workerCjsPath = path.resolve(_dirname, 'worker.cjs')
export const workerMjsPath = path.resolve(_dirname, 'worker.mjs')
export const workerMjsAsMtsPath = path.resolve(_dirname, 'worker-mts.mjs')
export const workerMtsPath = path.resolve(_dirname, 'worker-mts.mts')
export const workerErrorPath = path.resolve(_dirname, 'worker-error.cjs')

export const testIf = (condition: boolean) => (condition ? it : it.skip)

type ReceiveMessageOnPortMock = jest.Mock<
  <T>(port: WorkerThreads.MessagePort) => { message: WorkerToMainMessage<T> }
>
export const setupReceiveMessageOnPortMock =
  async (): Promise<ReceiveMessageOnPortMock> => {
    jest.unstable_mockModule('node:worker_threads', () => ({
      ...WorkerThreads,
      receiveMessageOnPort: jest.fn(WorkerThreads.receiveMessageOnPort),
    }))

    const { receiveMessageOnPort } = await import('node:worker_threads')

    return receiveMessageOnPort as ReceiveMessageOnPortMock
  }
