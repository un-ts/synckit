import path from 'node:path'
import { fileURLToPath } from 'node:url'
import WorkerThreads from 'node:worker_threads'

import { jest } from '@jest/globals'

import { MTS_SUPPORTED_NODE_VERSION } from 'synckit'

export const _dirname = path.dirname(fileURLToPath(import.meta.url))

export const nodeVersion = Number.parseFloat(process.versions.node)

export const tsUseEsmSupported =
  // https://github.com/privatenumber/tsx/issues/354
  // eslint-disable-next-line @typescript-eslint/no-magic-numbers
  nodeVersion >= MTS_SUPPORTED_NODE_VERSION && nodeVersion <= 18.18

export const testIf = (condition: boolean) => (condition ? it : it.skip)

type ReceiveMessageOnPortMock = jest.Mock<
  typeof WorkerThreads.receiveMessageOnPort
>
export const setupReceiveMessageOnPortMock =
  async (): Promise<ReceiveMessageOnPortMock> => {
    jest.unstable_mockModule('node:worker_threads', () => {
      return {
        ...WorkerThreads,
        receiveMessageOnPort: jest.fn(WorkerThreads.receiveMessageOnPort),
      }
    })

    const { receiveMessageOnPort: receiveMessageOnPortMock } = (await import(
      'node:worker_threads'
    )) as unknown as {
      receiveMessageOnPort: ReceiveMessageOnPortMock
    }

    return receiveMessageOnPortMock
  }
