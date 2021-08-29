import fs from 'fs'
import { createRequire } from 'module'
import path from 'path'

import { jest } from '@jest/globals'

import { createSyncFn, tmpdir } from 'synckit'

type AsyncWorkerFn<T = number> = (result: T, timeout?: number) => Promise<T>

beforeEach(() => {
  jest.resetModules()
  delete process.env.SYNCKIT_BUFFER_SIZE
  delete process.env.SYNCKIT_TIMEOUT
  delete process.env.SYNCKIT_WORKER_THREADS

  process.env.SYNCKIT_TS_ESM = '1'
})

const cjsRequire = createRequire(import.meta.url)

const workerTsPath = cjsRequire.resolve('./worker-ts')
const workerCjsPath = cjsRequire.resolve('./worker.cjs')
const workerMjsPath = cjsRequire.resolve('./worker.mjs')
const workerErrorPath = cjsRequire.resolve('./worker-error.cjs')

test('createSyncFn with worker threads', () => {
  expect(() => createSyncFn('./fake')).toThrow('`workerPath` must be absolute')
  expect(() => createSyncFn(cjsRequire.resolve('eslint'))).not.toThrow()

  const syncFn1 = createSyncFn<AsyncWorkerFn>(workerCjsPath)
  const syncFn2 = createSyncFn<AsyncWorkerFn>(workerCjsPath)
  const syncFn3 = createSyncFn<AsyncWorkerFn>(workerMjsPath)

  expect(() => createSyncFn(cjsRequire.resolve('../src'))).toThrow(
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

test('createSyncFn with child process', async () => {
  process.env.SYNCKIT_WORKER_THREADS = '0'

  const { createSyncFn } = await import('synckit')

  expect(() => createSyncFn('./fake')).toThrow('`workerPath` must be absolute')
  expect(() => createSyncFn(cjsRequire.resolve('eslint'))).not.toThrow()

  const syncFn1 = createSyncFn<AsyncWorkerFn>(workerTsPath)
  const syncFn2 = createSyncFn<AsyncWorkerFn>(workerTsPath)
  const syncFn3 = createSyncFn(cjsRequire.resolve('../src'))
  const errSyncFn = createSyncFn<() => Promise<void>>(workerErrorPath)

  expect(syncFn1).toBe(syncFn2)
  expect(syncFn1).not.toBe(syncFn3)
  expect(syncFn1(1)).toBe(1)
  expect(syncFn1(2)).toBe(2)
  expect(syncFn1(5, 0)).toBe(5)
  expect(() => errSyncFn()).toThrow('Worker Error')

  const syncFn4 = createSyncFn<AsyncWorkerFn>(workerCjsPath)

  expect(syncFn4(1)).toBe(1)
  expect(syncFn4(2)).toBe(2)
  expect(syncFn4(5, 0)).toBe(5)
})

test('env with worker threads', async () => {
  process.env.SYNCKIT_BUFFER_SIZE = '0'
  process.env.SYNCKIT_TIMEOUT = '1'
  process.env.SYNCKIT_TS_ESM = '0'

  const { createSyncFn } = await import('synckit')
  const syncFn = createSyncFn<AsyncWorkerFn>(workerCjsPath)

  expect(() => syncFn(1, 100)).toThrow(
    'Internal error: Atomics.wait() failed: timed-out',
  )
})

test('env with child process', async () => {
  process.env.SYNCKIT_BUFFER_SIZE = '0'
  process.env.SYNCKIT_TIMEOUT = '1'
  process.env.SYNCKIT_WORKER_THREADS = '0'

  const { createSyncFn } = await import('synckit')
  const syncFn = createSyncFn<AsyncWorkerFn>(workerTsPath)

  expect(() => syncFn(1, 100)).toThrow('spawnSync /bin/sh ETIMEDOUT')
})

/**
 * It should be covered by above tests,
 * but the jest coverage does not work for child_process,
 * so we have to test it again manually.
 * @link https://github.com/facebook/jest/issues/5274
 */
test('runAsWorker with child process', async () => {
  process.env.SYNCKIT_WORKER_THREADS = '0'

  const { runAsWorker } = await import('synckit')

  const originalArgv = process.argv

  const filename = path.resolve(tmpdir, 'synckit-test.json')
  fs.writeFileSync(filename, JSON.stringify([]))

  process.argv = ['ts-node', workerCjsPath, filename]
  let result = await runAsWorker(() => Promise.resolve(1))
  expect(result).toBe(undefined)
  expect(fs.readFileSync(filename, 'utf8')).toBe(JSON.stringify({ result: 1 }))

  fs.writeFileSync(filename, JSON.stringify([]))
  process.argv = ['ts-node', workerErrorPath, filename]
  result = await runAsWorker(() => Promise.reject(new Error('Error!')))
  expect(result).toBe(undefined)
  expect(JSON.parse(fs.readFileSync(filename, 'utf8'))).toMatchObject({
    error: { name: 'Error', message: 'Error!' },
  })

  fs.unlinkSync(filename)

  process.argv = originalArgv
})
