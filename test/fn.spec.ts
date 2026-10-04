/* eslint-disable jest/no-standalone-expect */
import { pathToFileURL } from 'node:url'

import { jest } from '@jest/globals'
import { cjsRequire } from '@pkgr/core'

import {
  setupReceiveMessageOnPortMock,
  testIf,
  workerCjsPath,
  workerCjsTsPath,
  workerErrorPath,
  workerErrorPrimitivePath,
  workerEsmTsPath,
  workerJsAsTsPath,
  workerMjsPath,
  workerNoExtAsJsPath,
} from './helpers.js'
import type { AsyncWorkerFn } from './types.js'

import {
  type StdioChunk,
  TS_ESM_PARTIAL_SUPPORTED,
  createSyncFn,
} from 'synckit'

const { SYNCKIT_TIMEOUT } = process.env

beforeEach(() => {
  jest.resetModules()
  jest.restoreAllMocks()

  delete process.env.SYNCKIT_GLOBAL_SHIMS

  if (SYNCKIT_TIMEOUT) {
    process.env.SYNCKIT_TIMEOUT = SYNCKIT_TIMEOUT
  } else {
    delete process.env.SYNCKIT_TIMEOUT
  }
})

test('ts as cjs', () => {
  const syncFn = createSyncFn<AsyncWorkerFn>(workerCjsTsPath)
  expect(syncFn(1)).toBe(1)
  expect(syncFn(2)).toBe(2)
  expect(syncFn(5)).toBe(5)
})

testIf(TS_ESM_PARTIAL_SUPPORTED)('ts as esm', () => {
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

testIf(TS_ESM_PARTIAL_SUPPORTED)('js as ts (as esm)', () => {
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

  // a reason that is not an object is thrown as it came, not boxed by the property merge
  const primitiveErrSyncFn = createSyncFn<(reason: unknown) => Promise<void>>(
    workerErrorPrimitivePath,
  )
  let caught: unknown
  try {
    primitiveErrSyncFn('Worker primitive rejection')
  } catch (error) {
    caught = error
  }
  expect(caught).toBe('Worker primitive rejection')

  // a falsy reason used to be indistinguishable from a successful `undefined` result: every one
  // must still throw exactly as it was thrown, `undefined` and `null` included
  const notThrown = Symbol('not thrown')
  const thrownBy = (reason: unknown) => {
    try {
      primitiveErrSyncFn(reason)
    } catch (error) {
      return error
    }
    return notThrown
  }
  for (const reason of [undefined, null, 0, '', false, Number.NaN]) {
    expect(thrownBy(reason)).toBe(reason)
  }

  const syncFn4 = createSyncFn<AsyncWorkerFn>(workerCjsPath)

  expect(syncFn4(1)).toBe(1)
  expect(syncFn4(2)).toBe(2)
  expect(syncFn4(5, 0)).toBe(5)
})

test('timeout', async () => {
  process.env.SYNCKIT_TIMEOUT = '1'

  const { createSyncFn } = await import('synckit')
  const syncFn = createSyncFn<AsyncWorkerFn>(workerCjsPath)

  expect(() => syncFn(1, 100)).toThrow(
    'Internal error: Atomics.wait() failed: timed-out',
  )
})

test('subsequent executions after timeout', async () => {
  const executionTimeout = 30
  const longRunningTaskDuration = executionTimeout * 10
  process.env.SYNCKIT_TIMEOUT = executionTimeout.toString()

  const { createSyncFn } = await import('synckit')
  const syncFn = createSyncFn<AsyncWorkerFn>(workerCjsPath)

  // start an execution in worker that will definitely time out
  expect(() => syncFn(1, longRunningTaskDuration)).toThrow()

  // wait for timed out execution to finish inside worker
  await new Promise(resolve => setTimeout(resolve, longRunningTaskDuration))

  // subsequent executions should work correctly
  expect(syncFn(2, 1)).toBe(2)
  expect(syncFn(3, 1)).toBe(3)
})

const stdio: StdioChunk[] = []

test('handling of outdated message from worker', async () => {
  const executionTimeout = 60
  process.env.SYNCKIT_TIMEOUT = executionTimeout.toString()
  const receiveMessageOnPortMock = await setupReceiveMessageOnPortMock()

  jest.spyOn(Atomics, 'wait').mockReturnValue('ok')

  receiveMessageOnPortMock
    .mockReturnValueOnce({ message: { id: -1, stdio, result: undefined } })
    .mockReturnValueOnce({ message: { id: 0, stdio, result: 1 } })

  const { createSyncFn } = await import('synckit')
  const syncFn = createSyncFn<AsyncWorkerFn>(workerCjsPath)
  expect(syncFn(1)).toBe(1)
  expect(receiveMessageOnPortMock).toHaveBeenCalledTimes(2)
})

test('waits again when a notification arrives before its message', async () => {
  const receiveMessageOnPortMock = await setupReceiveMessageOnPortMock()

  jest.spyOn(Atomics, 'wait').mockReturnValue('ok')

  // the soak hits this about once in a hundred thousand calls: the wait is woken but the message it
  // announces is not readable yet, so the call has to wait again instead of failing
  receiveMessageOnPortMock
    // eslint-disable-next-line unicorn-x/no-useless-undefined -- returning nothing is the case here
    .mockReturnValueOnce(undefined)
    .mockReturnValueOnce({ message: { id: 0, stdio, result: 1 } })

  const { createSyncFn } = await import('synckit')
  const syncFn = createSyncFn<AsyncWorkerFn>(workerCjsPath)
  expect(syncFn(1)).toBe(1)
  expect(receiveMessageOnPortMock).toHaveBeenCalledTimes(2)
})

test('never consumes a notification the counter does not show', async () => {
  const receiveMessageOnPortMock = await setupReceiveMessageOnPortMock()

  jest.spyOn(Atomics, 'wait').mockReturnValue('ok')

  receiveMessageOnPortMock
    .mockReturnValueOnce({ message: { id: -1, stdio, result: undefined } })
    .mockReturnValueOnce({ message: { id: 0, stdio, result: 1 } })

  // `Atomics.wait` here reports a notification the counter never received. Consuming it must not
  // take the counter below zero: every later wait would then return at once, so the caller would
  // spin instead of sleeping and starve the worker until its deadline expires.
  const observed: number[] = []
  const sub = Atomics.sub

  const subSpy = jest.spyOn(Atomics, 'sub')

  subSpy.mockImplementation(((
    array: Int32Array,
    index: number,
    value: number,
  ) => {
    observed.push(Atomics.load(array, index))
    return sub(array, index, value)
  }) as unknown as typeof Atomics.sub)

  const { createSyncFn } = await import('synckit')
  const syncFn = createSyncFn<AsyncWorkerFn>(workerCjsPath)
  expect(syncFn(1)).toBe(1)

  for (const counter of observed) {
    expect(counter).toBeGreaterThan(0)
  }
})

test('propagation of undefined timeout', async () => {
  delete process.env.SYNCKIT_TIMEOUT
  const receiveMessageOnPortMock = await setupReceiveMessageOnPortMock()

  const atomicsWaitSpy = jest.spyOn(Atomics, 'wait').mockReturnValue('ok')

  receiveMessageOnPortMock
    .mockReturnValueOnce({ message: { id: -1, stdio, result: undefined } })
    .mockReturnValueOnce({ message: { id: 0, stdio, result: 1 } })

  const { createSyncFn } = await import('synckit')
  const syncFn = createSyncFn<AsyncWorkerFn>(workerCjsPath)
  expect(syncFn(1)).toBe(1)
  expect(receiveMessageOnPortMock).toHaveBeenCalledTimes(2)

  const [firstAtomicsWaitArgs, secondAtomicsWaitArgs] =
    atomicsWaitSpy.mock.calls
  const [, , , firstAtomicsWaitCallTimeout] = firstAtomicsWaitArgs
  const [, , , secondAtomicsWaitCallTimeout] = secondAtomicsWaitArgs

  expect(typeof firstAtomicsWaitCallTimeout).toBe('undefined')
  expect(typeof secondAtomicsWaitCallTimeout).toBe('undefined')
})

test('reduction of waiting time', async () => {
  const synckitTimeout = 60
  process.env.SYNCKIT_TIMEOUT = synckitTimeout.toString()
  const receiveMessageOnPortMock = await setupReceiveMessageOnPortMock()

  const atomicsWaitSpy = jest.spyOn(Atomics, 'wait').mockImplementation(() => {
    const start = Date.now()
    // simulate waiting 10ms for worker to respond
    while (Date.now() - start < 10) {
      continue
    }

    return 'ok'
  })

  receiveMessageOnPortMock
    .mockReturnValueOnce({ message: { id: -1, stdio, result: undefined } })
    .mockReturnValueOnce({ message: { id: 0, stdio, result: 1 } })

  const { createSyncFn } = await import('synckit')
  const syncFn = createSyncFn<AsyncWorkerFn>(workerCjsPath)
  expect(syncFn(1)).toBe(1)
  expect(receiveMessageOnPortMock).toHaveBeenCalledTimes(2)

  const [firstAtomicsWaitArgs, secondAtomicsWaitArgs] =
    atomicsWaitSpy.mock.calls
  const [, , , firstAtomicsWaitCallTimeout] = firstAtomicsWaitArgs
  const [, , , secondAtomicsWaitCallTimeout] = secondAtomicsWaitArgs

  expect(typeof firstAtomicsWaitCallTimeout).toBe('number')
  expect(firstAtomicsWaitCallTimeout).toBe(synckitTimeout)
  expect(typeof secondAtomicsWaitCallTimeout).toBe('number')
  expect(secondAtomicsWaitCallTimeout).toBeLessThan(synckitTimeout)
})

test('a per-call deadline shrinks each successive wait across outdated messages', async () => {
  const synckitTimeout = 60
  process.env.SYNCKIT_TIMEOUT = synckitTimeout.toString()
  const receiveMessageOnPortMock = await setupReceiveMessageOnPortMock()

  const atomicsWaitSpy = jest.spyOn(Atomics, 'wait').mockImplementation(() => {
    const start = Date.now()
    // simulate waiting 10ms for worker to respond
    while (Date.now() - start < 10) {
      continue
    }

    return 'ok'
  })

  receiveMessageOnPortMock
    .mockReturnValueOnce({ message: { id: -2, stdio, result: undefined } })
    .mockReturnValueOnce({ message: { id: -1, stdio, result: undefined } })
    .mockReturnValueOnce({ message: { id: 0, stdio, result: 1 } })

  const { createSyncFn } = await import('synckit')
  const syncFn = createSyncFn<AsyncWorkerFn>(workerCjsPath)
  expect(syncFn(1)).toBe(1)
  expect(receiveMessageOnPortMock).toHaveBeenCalledTimes(3)

  const [firstWaitArgs, secondWaitArgs, thirdWaitArgs] =
    atomicsWaitSpy.mock.calls
  const [, , , firstTimeout] = firstWaitArgs
  const [, , , secondTimeout] = secondWaitArgs
  const [, , , thirdTimeout] = thirdWaitArgs

  // the budget belongs to the call, not to each wait: the first wait gets all of it and every wait
  // after an outdated message gets what is left, never a negative remainder. A loaded or coarse
  // clock can already have reached the deadline, where `0` means the deadline is due rather than a
  // wrong value, so it is not required to stay above zero.
  expect(firstTimeout).toBe(synckitTimeout)
  expect(secondTimeout).toBeGreaterThanOrEqual(0)
  expect(secondTimeout).toBeLessThan(firstTimeout!)
  expect(thirdTimeout).toBeGreaterThanOrEqual(0)
  expect(thirdTimeout).toBeLessThanOrEqual(secondTimeout!)
})

test('an exhausted budget waits with 0 and fails at the deadline', async () => {
  process.env.SYNCKIT_TIMEOUT = '20'
  const receiveMessageOnPortMock = await setupReceiveMessageOnPortMock()

  const atomicsWaitSpy = jest
    .spyOn(Atomics, 'wait')
    .mockImplementation((_typedArray, _index, _value, timeout) => {
      const start = Date.now()
      // each wait outlives what is left of the 20ms budget, so the remainder must be clamped
      while (Date.now() - start < 15) {
        continue
      }

      // like the real thing: a due deadline gives up now instead of waiting
      return timeout !== undefined && timeout <= 0 ? 'timed-out' : 'ok'
    })

  receiveMessageOnPortMock.mockReturnValue({
    message: { id: -1, stdio, result: undefined },
  })

  const { createSyncFn } = await import('synckit')
  const syncFn = createSyncFn<AsyncWorkerFn>(workerCjsPath)

  // the deadline is reached and reported, rather than the wait becoming indefinite
  expect(() => syncFn(1)).toThrow('Atomics.wait() failed: timed-out')

  const timeouts = atomicsWaitSpy.mock.calls.map(([, , , timeout]) => timeout)
  expect(timeouts.every(timeout => timeout! >= 0)).toBe(true)
  expect(timeouts).toContain(0)
})

test('unexpected message from worker', async () => {
  jest.spyOn(Atomics, 'wait').mockReturnValue('ok')

  const receiveMessageOnPortMock = await setupReceiveMessageOnPortMock()
  receiveMessageOnPortMock.mockReturnValueOnce({
    message: { id: 100, stdio, result: undefined },
  })

  const { createSyncFn } = await import('synckit')
  const syncFn = createSyncFn<AsyncWorkerFn>(workerCjsPath)
  expect(() => syncFn(1)).toThrow(
    'Internal error: Expected id 0 but got id 100',
  )
})

test('globalShims env', async () => {
  process.env.SYNCKIT_GLOBAL_SHIMS = '1'

  const { createSyncFn } = await import('synckit')
  const syncFn = createSyncFn<AsyncWorkerFn>(workerCjsPath)

  expect(syncFn(1)).toBe(1)
  expect(syncFn(2)).toBe(2)
  expect(syncFn(5, 0)).toBe(5)
})

test('globalShims options', async () => {
  const { createSyncFn } = await import('synckit')

  const syncFn = createSyncFn<AsyncWorkerFn>(workerCjsPath, {
    globalShims: [
      {
        moduleName: 'non-existed',
      },
    ],
  })

  expect(syncFn(1)).toBe(1)
  expect(syncFn(2)).toBe(2)
  expect(syncFn(5, 0)).toBe(5)
})

test('support file url', async () => {
  const { createSyncFn } = await import('synckit')

  const syncFn = createSyncFn<AsyncWorkerFn>(pathToFileURL(workerCjsPath), {})

  expect(syncFn(1)).toBe(1)
  expect(syncFn(2)).toBe(2)
  expect(syncFn(5, 0)).toBe(5)

  expect(() => createSyncFn(new URL('https://example.com'))).toThrow(
    'The URL must be of scheme file',
  )
})

test('support file url protocol', async () => {
  const { createSyncFn } = await import('synckit')

  const syncFn = createSyncFn<AsyncWorkerFn>(
    pathToFileURL(workerCjsPath).href,
    {},
  )

  expect(syncFn(1)).toBe(1)
  expect(syncFn(2)).toBe(2)
  expect(syncFn(5, 0)).toBe(5)
})
