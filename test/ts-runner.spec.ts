/* eslint-disable jest/valid-title */

import path from 'node:path'

import { jest } from '@jest/globals'

import { _dirname } from './helpers.js'
import type { AsyncWorkerFn } from './types.js'

import { MTS_SUPPORTED_NODE_VERSION, TsRunner } from 'synckit'

beforeEach(() => {
  jest.resetModules()
})

it(TsRunner.EsbuildRegister, async () => {
  const { createSyncFn } = await import('synckit')
  const syncFn = createSyncFn<AsyncWorkerFn>(
    path.resolve(_dirname, 'esbuild-register.worker.mjs'),
    {
      tsRunner: TsRunner.EsbuildRegister,
    },
  )
  expect(syncFn(1)).toBe(1)
  expect(syncFn(2)).toBe(2)
  expect(syncFn(5)).toBe(5)

  expect(() =>
    createSyncFn<AsyncWorkerFn>(
      path.resolve(_dirname, 'esbuild-register-error.worker.mjs'),
      {
        tsRunner: TsRunner.EsbuildRegister,
      },
    ),
  ).toThrowError('esbuild-register is not supported for .mts files yet')
})

it(TsRunner.EsbuildRunner, async () => {
  const { createSyncFn } = await import('synckit')
  const syncFn = createSyncFn<AsyncWorkerFn>(
    path.resolve(_dirname, 'esbuild-runner.worker.mjs'),
    {
      tsRunner: TsRunner.EsbuildRunner,
    },
  )
  expect(syncFn(1)).toBe(1)
  expect(syncFn(2)).toBe(2)
  expect(syncFn(5)).toBe(5)

  expect(() =>
    createSyncFn<AsyncWorkerFn>(
      path.resolve(_dirname, 'esbuild-runner-error.worker.mjs'),
      {
        tsRunner: TsRunner.EsbuildRunner,
      },
    ),
  ).toThrowError('esbuild-runner is not supported for .mts files yet')
})

it(TsRunner.TSX, async () => {
  const { createSyncFn } = await import('synckit')

  if (Number.parseFloat(process.versions.node) < MTS_SUPPORTED_NODE_VERSION) {
    // eslint-disable-next-line jest/no-conditional-expect
    expect(() =>
      createSyncFn<AsyncWorkerFn>(path.resolve(_dirname, 'tsx.worker.mjs'), {
        tsRunner: TsRunner.TSX,
      }),
    ).toThrowError('tsx is not supported for .mts files yet')
    return
  }

  const syncFn = createSyncFn<AsyncWorkerFn>(
    path.resolve(_dirname, 'tsx.worker.mjs'),
    {
      tsRunner: TsRunner.TSX,
    },
  )
  expect(syncFn(1)).toBe(1)
  expect(syncFn(2)).toBe(2)
  expect(syncFn(5)).toBe(5)
})

it('unknown ts runner', async () => {
  const { createSyncFn } = await import('synckit')

  expect(() =>
    // @ts-expect-error
    createSyncFn<AsyncWorkerFn>(path.resolve(_dirname, 'worker.js'), {
      tsRunner: 'unknown',
    }),
  ).toThrowErrorMatchingInlineSnapshot(`"Unknown ts runner: unknown"`)
})
