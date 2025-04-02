import path from 'node:path'
import { fileURLToPath } from 'node:url'
import WorkerThreads from 'node:worker_threads'

import { jest } from '@jest/globals'

import { type WorkerToMainMessage } from 'synckit'

export const _dirname = path.dirname(fileURLToPath(import.meta.url))

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
