type AsyncWorkerFn<T = number> = (result: T, timeout?: number) => Promise<T>

beforeEach(() => {
  jest.resetModules()
  process.env.SYNCKIT_TS_ESM = '0'
})

afterEach(() => {
  delete process.env.SYNCKIT_BUFFER_SIZE
  delete process.env.SYNCKIT_TIMEOUT
  delete process.env.SYNCKIT_TS_ESM
})

const workerTsPath = require.resolve('./worker.ts')
const workerCjsPath = require.resolve('./worker.cjs')
const workerMjsPath = require.resolve('./worker.mjs')
const workerErrorPath = require.resolve('./worker-error.cjs')

describe('cjs', () => {
  test('createSyncFn', async () => {
    const { createSyncFn } = await import('synckit')

    expect(() => createSyncFn('./fake')).toThrow(
      '`workerPath` must be absolute',
    )
    expect(() => createSyncFn(require.resolve('eslint'))).not.toThrow()

    const syncFn1 = createSyncFn<AsyncWorkerFn>(workerCjsPath)
    const syncFn2 = createSyncFn<AsyncWorkerFn>(workerCjsPath)
    const syncFn3 = createSyncFn<AsyncWorkerFn>(workerMjsPath)

    expect(() => createSyncFn(workerTsPath)).not.toThrow(
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

    const { createSyncFn } = await import('synckit')
    const syncFn = createSyncFn<AsyncWorkerFn>(workerCjsPath)

    expect(() => syncFn(1, 100)).toThrow(
      'Internal error: Atomics.wait() failed: timed-out',
    )
  })
})
