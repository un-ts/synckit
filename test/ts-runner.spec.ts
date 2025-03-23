/* eslint-disable jest/valid-title */

import path from 'node:path'

import { jest } from '@jest/globals'

import { _dirname, tsUseEsmSupported } from './helpers.js'
import type { AsyncWorkerFn } from './types.js'

import {
  MTS_SUPPORTED_NODE_VERSION,
  NODE_VERSION,
  STRIP_TYPES_NODE_VERSION,
  TsRunner,
  NO_STRIP_TYPES_FLAG,
  compareVersion,
} from 'synckit'

beforeEach(() => {
  jest.resetModules()
})

const workerJsPath = path.resolve(_dirname, 'worker-js')
const workerMjsPath = path.resolve(_dirname, 'worker.mjs')
const workerMtsPath = path.resolve(_dirname, 'worker-mts.mjs')

test(TsRunner.EsbuildRegister, async () => {
  const { createSyncFn } = await import('synckit')

  let syncFn = createSyncFn<AsyncWorkerFn>(workerJsPath, {
    tsRunner: TsRunner.EsbuildRegister,
  })
  expect(syncFn(1)).toBe(1)
  expect(syncFn(2)).toBe(2)
  expect(syncFn(5)).toBe(5)

  syncFn = createSyncFn<AsyncWorkerFn>(workerMjsPath, {
    tsRunner: TsRunner.EsbuildRegister,
  })
  expect(syncFn(1)).toBe(1)
  expect(syncFn(2)).toBe(2)
  expect(syncFn(5)).toBe(5)

  if (tsUseEsmSupported) {
    // eslint-disable-next-line jest/no-conditional-expect
    expect(() =>
      createSyncFn<AsyncWorkerFn>(workerMtsPath, {
        tsRunner: TsRunner.EsbuildRegister,
      }),
    ).toThrow('esbuild-register is not supported for .mts files yet')
  }
})

test(TsRunner.EsbuildRunner, async () => {
  const { createSyncFn } = await import('synckit')

  let syncFn = createSyncFn<AsyncWorkerFn>(workerJsPath, {
    tsRunner: TsRunner.EsbuildRunner,
  })
  expect(syncFn(1)).toBe(1)
  expect(syncFn(2)).toBe(2)
  expect(syncFn(5)).toBe(5)

  syncFn = createSyncFn<AsyncWorkerFn>(workerMjsPath, {
    tsRunner: TsRunner.EsbuildRunner,
  })
  expect(syncFn(1)).toBe(1)
  expect(syncFn(2)).toBe(2)
  expect(syncFn(5)).toBe(5)

  if (tsUseEsmSupported) {
    // eslint-disable-next-line jest/no-conditional-expect
    expect(() =>
      createSyncFn<AsyncWorkerFn>(workerMtsPath, {
        tsRunner: TsRunner.EsbuildRunner,
      }),
    ).toThrow('esbuild-runner is not supported for .mts files yet')
  }
})

test(TsRunner.SWC, async () => {
  const { createSyncFn } = await import('synckit')

  let syncFn = createSyncFn<AsyncWorkerFn>(workerJsPath, {
    tsRunner: TsRunner.SWC,
  })
  expect(syncFn(1)).toBe(1)
  expect(syncFn(2)).toBe(2)
  expect(syncFn(5)).toBe(5)

  syncFn = createSyncFn<AsyncWorkerFn>(workerMjsPath, {
    tsRunner: TsRunner.SWC,
  })
  expect(syncFn(1)).toBe(1)
  expect(syncFn(2)).toBe(2)
  expect(syncFn(5)).toBe(5)

  if (tsUseEsmSupported) {
    // eslint-disable-next-line jest/no-conditional-expect
    expect(() =>
      createSyncFn<AsyncWorkerFn>(workerMtsPath, {
        tsRunner: TsRunner.SWC,
      }),
    ).toThrow('swc is not supported for .mts files yet')
  }
})

test(TsRunner.TSX, async () => {
  const { createSyncFn } = await import('synckit')

  let syncFn = createSyncFn<AsyncWorkerFn>(workerJsPath, {
    tsRunner: TsRunner.TSX,
  })
  expect(syncFn(1)).toBe(1)
  expect(syncFn(2)).toBe(2)
  expect(syncFn(5)).toBe(5)

  // <
  if (compareVersion(NODE_VERSION, MTS_SUPPORTED_NODE_VERSION) < 0) {
    // eslint-disable-next-line jest/no-conditional-expect
    expect(() =>
      createSyncFn<AsyncWorkerFn>(workerMtsPath, {
        tsRunner: TsRunner.TSX,
      }),
    ).toThrow('tsx is not supported for .mts files yet')
    return
  }

  if (!tsUseEsmSupported) {
    return
  }

  syncFn = createSyncFn<AsyncWorkerFn>(workerMtsPath, {
    tsRunner: TsRunner.TSX,
  })
  expect(syncFn(1)).toBe(1)
  expect(syncFn(2)).toBe(2)
  expect(syncFn(5)).toBe(5)
})

test(TsRunner.Node, async () => {
  const { createSyncFn } = await import('synckit')

  // <
  if (compareVersion(NODE_VERSION, STRIP_TYPES_NODE_VERSION) < 0) {
    // eslint-disable-next-line jest/no-conditional-expect
    expect(() =>
      createSyncFn<AsyncWorkerFn>(workerMtsPath, {
        tsRunner: TsRunner.Node,
      }),
    ).toThrow('type stripping is not supported in this node version')
    return
  }

  expect(() =>
    createSyncFn<AsyncWorkerFn>(workerMtsPath, {
      tsRunner: TsRunner.Node,
      execArgv: [NO_STRIP_TYPES_FLAG],
    }),
  ).toThrow('type stripping is disabled explicitly')

  let syncFn = createSyncFn<AsyncWorkerFn>(workerJsPath)

  expect(syncFn(1)).toBe(1)
  expect(syncFn(2)).toBe(2)
  expect(syncFn(5)).toBe(5)

  if (!tsUseEsmSupported) {
    return
  }

  syncFn = createSyncFn<AsyncWorkerFn>(workerMtsPath)
  expect(syncFn(1)).toBe(1)
  expect(syncFn(2)).toBe(2)
  expect(syncFn(5)).toBe(5)
})

test('unknown ts runner', async () => {
  const { createSyncFn } = await import('synckit')

  expect(() =>
    createSyncFn<AsyncWorkerFn>(path.resolve(_dirname, 'worker.js'), {
      // @ts-expect-error -- intended
      tsRunner: 'unknown',
    }),
  ).toThrowErrorMatchingInlineSnapshot(`"Unknown ts runner: unknown"`)
})
