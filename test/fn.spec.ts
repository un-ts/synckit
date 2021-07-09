import fs from 'fs'
import path from 'path'

import { createSyncFn, tmpdir } from 'synckit'

test('createSyncFn with worker threads', () => {
  process.env.SYNCKIT_WORKER_THREADS = '1'

  expect(() => createSyncFn('./fake')).toThrow('`workerPath` must be absolute')
  expect(() => createSyncFn(require.resolve('eslint'))).not.toThrow()

  // eslint-disable-next-line sonarjs/no-duplicate-string
  const syncFn1 = createSyncFn(require.resolve('./worker-ts'))
  const syncFn2 = createSyncFn(require.resolve('./worker-ts'))
  const syncFn3 = createSyncFn(require.resolve('../src'))
  // eslint-disable-next-line sonarjs/no-duplicate-string
  const errSyncFn = createSyncFn(require.resolve('./worker-error'))

  expect(syncFn1).toBe(syncFn2)
  expect(syncFn1).not.toBe(syncFn3)
  expect(syncFn1(1)).toBe(1)
  expect(syncFn1(2)).toBe(2)
  expect(syncFn1(5, 0)).toBe(5)
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  expect(() => errSyncFn()).toThrow('Worker Error')

  const syncFn4 = createSyncFn(require.resolve('./worker'))

  expect(syncFn4(1)).toBe(1)
  expect(syncFn4(2)).toBe(2)
  expect(syncFn4(5, 0)).toBe(5)
})

test('createSyncFn with child process', () => {
  jest.resetModules()

  process.env.SYNCKIT_WORKER_THREADS = '0'

  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { createSyncFn } = require('synckit') as typeof import('synckit')

  expect(() => createSyncFn('./fake')).toThrow('`workerPath` must be absolute')
  expect(() => createSyncFn(require.resolve('eslint'))).not.toThrow()

  const syncFn1 = createSyncFn(require.resolve('./worker-ts'))
  const syncFn2 = createSyncFn(require.resolve('./worker-ts'))
  const syncFn3 = createSyncFn(require.resolve('../src'))
  const errSyncFn = createSyncFn(require.resolve('./worker-error'))

  expect(syncFn1).toBe(syncFn2)
  expect(syncFn1).not.toBe(syncFn3)
  expect(syncFn1(1)).toBe(1)
  expect(syncFn1(2)).toBe(2)
  expect(syncFn1(5, 0)).toBe(5)
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  expect(() => errSyncFn()).toThrow('Worker Error')

  const syncFn4 = createSyncFn(require.resolve('./worker'))

  expect(syncFn4(1)).toBe(1)
  expect(syncFn4(2)).toBe(2)
  expect(syncFn4(5, 0)).toBe(5)
})

/**
 * It should be covered by above tests,
 * but the jest coverage does not work for child_process,
 * so we have to test it again manually.
 * @link https://github.com/facebook/jest/issues/5274
 */
test('runAsWorker with child process', async () => {
  jest.resetModules()

  process.env.SYNCKIT_WORKER_THREADS = '0'

  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { runAsWorker } = require('synckit') as typeof import('synckit')

  const originalArgv = process.argv

  const filename = path.resolve(tmpdir, 'synckit-test.json')
  fs.writeFileSync(filename, JSON.stringify([]))

  process.argv = ['ts-node', require.resolve('./worker'), filename]
  let result = await runAsWorker(() => Promise.resolve(1))
  expect(result).toBe(undefined)
  expect(fs.readFileSync(filename, 'utf8')).toBe(JSON.stringify({ result: 1 }))

  fs.writeFileSync(filename, JSON.stringify([]))
  process.argv = ['ts-node', require.resolve('./worker-error'), filename]
  result = await runAsWorker(() => Promise.reject(new Error('Error!')))
  expect(result).toBe(undefined)
  expect(JSON.parse(fs.readFileSync(filename, 'utf8'))).toMatchObject({
    error: { name: 'Error', message: 'Error!' },
  })

  fs.unlinkSync(filename)

  process.argv = originalArgv
})
