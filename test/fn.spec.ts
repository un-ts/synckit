import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { jest } from '@jest/globals'

import { createSyncFn, extractProperties } from 'synckit'

type AsyncWorkerFn<T = number> = (result: T, timeout?: number) => Promise<T>

beforeEach(() => {
  jest.resetModules()

  delete process.env.SYNCKIT_BUFFER_SIZE
  delete process.env.SYNCKIT_TIMEOUT
})

const cjsRequire = createRequire(import.meta.url)

const _dirname =
  typeof __dirname === 'undefined'
    ? path.dirname(fileURLToPath(import.meta.url))
    : __dirname

const workerCjsTsPath = cjsRequire.resolve('./cjs/worker-cjs.ts')
const workerEsmTsPath = cjsRequire.resolve('./esm/worker-esm.ts')
const workerNoExtAsJsPath = path.resolve(_dirname, './worker-js')
const workerJsAsTsPath = path.resolve(_dirname, './worker.js')
const workerCjsPath = cjsRequire.resolve('./worker.cjs')
const workerMjsPath = cjsRequire.resolve('./worker.mjs')
const workerErrorPath = cjsRequire.resolve('./worker-error.cjs')

test('ts as cjs', () => {
  const syncFn = createSyncFn<AsyncWorkerFn>(workerCjsTsPath)
  expect(syncFn(1)).toBe(1)
  expect(syncFn(2)).toBe(2)
  expect(syncFn(5)).toBe(5)
})

test('ts as esm', () => {
  const syncFn = createSyncFn<AsyncWorkerFn>(workerEsmTsPath)
  expect(syncFn(1)).toBe(1)
  expect(syncFn(2)).toBe(2)
  expect(syncFn(5)).toBe(5)
})

test('no ext as js (as esm)', () => {
  const syncFn = createSyncFn<AsyncWorkerFn>(workerNoExtAsJsPath)
  expect(syncFn(1)).toBe(1)
  expect(syncFn(2)).toBe(2)
  expect(syncFn(5)).toBe(5)
})

test('js as ts (as esm)', () => {
  const syncFn = createSyncFn<AsyncWorkerFn>(workerJsAsTsPath)
  expect(syncFn(1)).toBe(1)
  expect(syncFn(2)).toBe(2)
  expect(syncFn(5)).toBe(5)
})

test('createSyncFn', () => {
  expect(() => createSyncFn('./fake')).toThrow('`workerPath` must be absolute')
  expect(() => createSyncFn(cjsRequire.resolve('eslint'))).not.toThrow()

  const syncFn1 = createSyncFn<AsyncWorkerFn>(workerCjsPath)
  const syncFn2 = createSyncFn<AsyncWorkerFn>(workerCjsPath)
  const syncFn3 = createSyncFn<AsyncWorkerFn>(workerMjsPath)

  const errSyncFn = createSyncFn<() => Promise<void>>(workerErrorPath)

  expect(syncFn1).toBe(syncFn2)
  expect(syncFn1).not.toBe(syncFn3)
  expect(syncFn1(1)).toBe(1)
  expect(syncFn1(2)).toBe(2)
  expect(syncFn1(5, 0)).toBe(5)

  expect(syncFn3(1)).toBe(1)
  expect(syncFn3(2)).toBe(2)
  expect(syncFn3(5, 0)).toBe(5)

  expect(() => errSyncFn()).toThrowErrorMatchingInlineSnapshot(`"Worker Error"`)

  const syncFn4 = createSyncFn<AsyncWorkerFn>(workerCjsPath)

  expect(syncFn4(1)).toBe(1)
  expect(syncFn4(2)).toBe(2)
  expect(syncFn4(5, 0)).toBe(5)
})

test('timeout', async () => {
  process.env.SYNCKIT_BUFFER_SIZE = '0'
  process.env.SYNCKIT_TIMEOUT = '1'

  const { createSyncFn } = await import('synckit')
  const syncFn = createSyncFn<AsyncWorkerFn>(workerCjsPath)

  expect(() => syncFn(1, 100)).toThrow(
    'Internal error: Atomics.wait() failed: timed-out',
  )
})

test('extractProperties', () => {
  expect(extractProperties()).toBeUndefined()
  expect(extractProperties({})).toEqual({})
  expect(extractProperties(new Error('message'))).toEqual({})
  expect(
    extractProperties(
      Object.assign(new Error('message'), {
        code: 'CODE',
      }),
    ),
  ).toEqual({
    code: 'CODE',
  })
})
