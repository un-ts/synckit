import path from 'node:path'
import { fileURLToPath } from 'node:url'
import WorkerThreads from 'node:worker_threads'

import { jest } from '@jest/globals'

import {
  type WorkerToMainMessage,
  MTS_SUPPORTED_NODE_VERSION,
  NODE_VERSION,
  compareVersion,
} from 'synckit'

export const _dirname = path.dirname(fileURLToPath(import.meta.url))

export const tsUseEsmSupported =
  // https://github.com/privatenumber/tsx/issues/354
  // >=
  compareVersion(NODE_VERSION, MTS_SUPPORTED_NODE_VERSION) >= 0 &&
  // <=
  compareVersion(NODE_VERSION, '18.18') <= 0

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
