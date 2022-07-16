/* eslint-disable jest/valid-title */

import path from 'node:path'

import { jest } from '@jest/globals'

import { _dirname } from './helpers.js'
import type { AsyncWorkerFn } from './types.js'

import { TsRunner } from 'synckit'

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
      path.resolve(_dirname, 'esbuild-register-error.worker.mts'),
      {
        tsRunner: TsRunner.EsbuildRegister,
      },
    ),
  ).toThrowErrorMatchingInlineSnapshot(
    `"esbuild-register is not supported for .mts files yet, you can try [tsx](https://github.com/esbuild-kit/tsx) instead"`,
  )
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
      path.resolve(_dirname, 'esbuild-runner-error.worker.mts'),
      {
        tsRunner: TsRunner.EsbuildRunner,
      },
    ),
  ).toThrowErrorMatchingInlineSnapshot(
    `"esbuild-runner is not supported for .mts files yet, you can try [tsx](https://github.com/esbuild-kit/tsx) instead"`,
  )
})

it(TsRunner.TSX, async () => {
  const { createSyncFn } = await import('synckit')
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
    createSyncFn<AsyncWorkerFn>(path.resolve(_dirname, 'worker.ts'), {
      tsRunner: 'unknown',
    }),
  ).toThrowErrorMatchingInlineSnapshot(`"Unknown ts runner: unknown"`)
})
