import fs from 'fs'
import path from 'path'

import { createSyncFn, runAsWorker, tmpdir } from 'synckit'

test('createSyncFn', () => {
  expect(() => createSyncFn('./fake')).toThrow('`workerPath` must be absolute')
  expect(() => createSyncFn(require.resolve('eslint'))).not.toThrow()

  const syncFn = createSyncFn(require.resolve('./worker'))
  const syncFn2 = createSyncFn(require.resolve('./worker'))
  const syncFn3 = createSyncFn(require.resolve('../src'))

  expect(syncFn).toBe(syncFn2)
  expect(syncFn).not.toBe(syncFn3)

  let now = Date.now()

  expect(syncFn(1)).toBe(1)
  const distance = Date.now() - now
  expect(distance > 500).toBe(true)

  const DIFF_RANGE = 200

  now = Date.now()
  expect(syncFn(2)).toBe(2)
  expect(distance - (Date.now() - now) < DIFF_RANGE).toBe(true)

  now = Date.now()
  expect(syncFn(5, 0)).toBe(5)
  expect(distance - (Date.now() - now) < 500 + DIFF_RANGE).toBe(true)
})

/**
 * It should be covered by above tests,
 * but the jest coverage does not work for child_process,
 * so we have to test it again manually.
 * @link https://github.com/facebook/jest/issues/5274
 */
test('runAsWorker', async () => {
  const originalArgv = process.argv

  const filename = path.resolve(tmpdir, 'synckit-test.json')
  fs.writeFileSync(filename, JSON.stringify([]))

  process.argv = ['ts-node', require.resolve('./worker'), filename]

  const result = await runAsWorker(() => Promise.resolve(1))

  expect(result).toBe(undefined)
  expect(fs.readFileSync(filename, 'utf8')).toBe('1')

  fs.unlinkSync(filename)

  process.argv = originalArgv
})
