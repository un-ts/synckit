import { execSync } from 'child_process'
import { tmpdir as _tmpdir } from 'os'
import path from 'path'
import fs from 'fs'

import { v4 as uuid } from 'uuid'

import { AnyAsyncFn, AnyFn, Syncify } from './types'

export * from './types'

/**
 * @link https://github.com/sindresorhus/temp-dir/blob/main/index.js#L9
 */
export const tmpdir = fs.realpathSync(_tmpdir())

let tsconfigPathsAvailable: boolean

const isTsconfigPathsAvailable = () => {
  if (typeof tsconfigPathsAvailable === 'boolean') {
    return tsconfigPathsAvailable
  }
  try {
    // eslint-disable-next-line node/no-extraneous-require
    tsconfigPathsAvailable = !!require.resolve('tsconfig-paths')
  } catch {
    /**
     * `require.resolve` can not be mocked to fail
     * @link https://github.com/facebook/jest/issues/9543
     */
    /* istanbul ignore next */
    tsconfigPathsAvailable = false
  }
  return tsconfigPathsAvailable
}

const syncFnCache = new Map<string, AnyFn>()

export function createSyncFn<T extends AnyAsyncFn>(
  workerPath: string,
): Syncify<T>
export function createSyncFn<R>(workerPath: string) {
  if (!path.isAbsolute(workerPath)) {
    throw new Error('`workerPath` must be absolute')
  }

  const cachedSyncFn = syncFnCache.get(workerPath)

  if (cachedSyncFn) {
    return cachedSyncFn
  }

  let resolvedWorkerPath = workerPath

  if (!resolvedWorkerPath.endsWith('.ts')) {
    resolvedWorkerPath = require.resolve(workerPath)
  }

  const executor = resolvedWorkerPath.endsWith('.ts')
    ? 'ts-node' +
      (isTsconfigPathsAvailable()
        ? ' -r tsconfig-paths/register'
        : /* istanbul ignore next */ '')
    : 'node'

  const syncFn = (...args: unknown[]): R => {
    const filename = path.resolve(tmpdir, `synckit-${uuid()}.json`)

    fs.writeFileSync(filename, JSON.stringify(args))

    const command = `${executor} ${resolvedWorkerPath} ${filename}`

    try {
      execSync(command, {
        stdio: 'inherit',
      })
      const result = fs.readFileSync(filename, 'utf8')
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
      return JSON.parse(result)
    } finally {
      fs.unlinkSync(filename)
    }
  }

  syncFnCache.set(workerPath, syncFn)

  return syncFn
}

export const runAsWorker = async <T extends AnyAsyncFn>(fn: T) => {
  const filename = process.argv[2]
  const content = fs.readFileSync(filename, 'utf-8')
  const options = JSON.parse(content) as Parameters<T>
  fs.writeFileSync(filename, JSON.stringify(await fn(...options)))
}
