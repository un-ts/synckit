import { createRequire } from 'module'

import { jest } from '@jest/globals'

import { createSyncFn } from 'synckit'

type AsyncWorkerFn<T = number> = (result: T, timeout?: number) => Promise<T>

beforeEach(() => {
  jest.resetModules()
  delete process.env.SYNCKIT_BUFFER_SIZE
  delete process.env.SYNCKIT_TIMEOUT

  process.env.SYNCKIT_TS_ESM = '1'
})

const cjsRequire = createRequire(import.meta.url)

const workerEsmTsPath = cjsRequire.resolve('./worker-esm.ts')
const workerCjsPath = cjsRequire.resolve('./worker.cjs')
const workerMjsPath = cjsRequire.resolve('./worker.mjs')
const workerErrorPath = cjsRequire.resolve('./worker-error.cjs')

test('createSyncFn', () => {
  expect(() => createSyncFn('./fake')).toThrow('`workerPath` must be absolute')
  expect(() => createSyncFn(cjsRequire.resolve('eslint'))).not.toThrow()

  const syncFn1 = createSyncFn<AsyncWorkerFn>(workerCjsPath)
  const syncFn2 = createSyncFn<AsyncWorkerFn>(workerCjsPath)
  const syncFn3 = createSyncFn<AsyncWorkerFn>(workerMjsPath)

  expect(() => createSyncFn(workerEsmTsPath)).toThrow(
    'Native esm in `.ts` file is not supported yet, please use `.cjs` instead',
  )

  const errSyncFn = createSyncFn<() => Promise<void>>(workerErrorPath)

  expect(syncFn1).toBe(syncFn2)
  expect(syncFn1).not.toBe(syncFn3)
  expect(syncFn1(1)).toBe(1)
  expect(syncFn1(2)).toBe(2)
  expect(syncFn1(5, 0)).toBe(5)

  expect(syncFn3(1)).toBe(1)
  expect(syncFn3(2)).toBe(2)
  expect(syncFn3(5, 0)).toBe(5)

  expect(() => errSyncFn()).toThrow('Worker Error')

  const syncFn4 = createSyncFn<AsyncWorkerFn>(workerCjsPath)

  expect(syncFn4(1)).toBe(1)
  expect(syncFn4(2)).toBe(2)
  expect(syncFn4(5, 0)).toBe(5)
})

test('timeout', async () => {
  process.env.SYNCKIT_BUFFER_SIZE = '0'
  process.env.SYNCKIT_TIMEOUT = '1'
  process.env.SYNCKIT_TS_ESM = '0'

  const { createSyncFn } = await import('synckit')
  const syncFn = createSyncFn<AsyncWorkerFn>(workerCjsPath)

  expect(() => syncFn(1, 100)).toThrow(
    'Internal error: Atomics.wait() failed: timed-out',
  )
})
