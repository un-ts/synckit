/* eslint-disable jest/no-conditional-expect, jest/valid-title */

import path from 'node:path'

import { jest } from '@jest/globals'

import { _dirname } from './helpers.js'
import type { AsyncWorkerFn } from './types.js'

import {
  STRIP_TYPES_NODE_VERSION,
  TsRunner,
  NO_STRIP_TYPES_FLAG,
  compareNodeVersion,
  TS_ESM_PARTIAL_SUPPORTED,
  MTS_SUPPORTED,
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

  if (TS_ESM_PARTIAL_SUPPORTED) {
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

  if (TS_ESM_PARTIAL_SUPPORTED) {
    expect(() =>
      createSyncFn<AsyncWorkerFn>(workerMtsPath, {
        tsRunner: TsRunner.EsbuildRunner,
      }),
    ).toThrow('esbuild-runner is not supported for .mts files yet')
  }
})

test(TsRunner.OXC, async () => {
  const { createSyncFn } = await import('synckit')

  let syncFn = createSyncFn<AsyncWorkerFn>(workerJsPath, {
    tsRunner: TsRunner.OXC,
  })
  expect(syncFn(1)).toBe(1)
  expect(syncFn(2)).toBe(2)
  expect(syncFn(5)).toBe(5)

  syncFn = createSyncFn<AsyncWorkerFn>(workerMjsPath, {
    tsRunner: TsRunner.OXC,
  })
  expect(syncFn(1)).toBe(1)
  expect(syncFn(2)).toBe(2)
  expect(syncFn(5)).toBe(5)

  if (TS_ESM_PARTIAL_SUPPORTED) {
    expect(() =>
      createSyncFn<AsyncWorkerFn>(workerMtsPath, {
        tsRunner: TsRunner.OXC,
      }),
    ).toThrow('oxc is not supported for .mts files yet')
  } else if (MTS_SUPPORTED) {
    syncFn = createSyncFn<AsyncWorkerFn>(workerMtsPath, {
      tsRunner: TsRunner.OXC,
    })
    expect(syncFn(1)).toBe(1)
    expect(syncFn(2)).toBe(2)
    expect(syncFn(5)).toBe(5)
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

  if (TS_ESM_PARTIAL_SUPPORTED) {
    expect(() =>
      createSyncFn<AsyncWorkerFn>(workerMtsPath, {
        tsRunner: TsRunner.SWC,
      }),
    ).toThrow('swc is not supported for .mts files yet')
  } else if (MTS_SUPPORTED) {
    syncFn = createSyncFn<AsyncWorkerFn>(workerMtsPath, {
      tsRunner: TsRunner.SWC,
    })
    expect(syncFn(1)).toBe(1)
    expect(syncFn(2)).toBe(2)
    expect(syncFn(5)).toBe(5)
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

  if (TS_ESM_PARTIAL_SUPPORTED) {
    syncFn = createSyncFn<AsyncWorkerFn>(workerMtsPath, {
      tsRunner: TsRunner.TSX,
    })
    expect(syncFn(1)).toBe(1)
    expect(syncFn(2)).toBe(2)
    expect(syncFn(5)).toBe(5)
  } else {
    expect(() =>
      createSyncFn<AsyncWorkerFn>(workerMtsPath, {
        tsRunner: TsRunner.TSX,
      }),
    ).toThrow('tsx is not supported for .mts files yet')
  }
})

test(TsRunner.Node, async () => {
  const { createSyncFn } = await import('synckit')

  // <
  if (compareNodeVersion(STRIP_TYPES_NODE_VERSION) < 0) {
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
