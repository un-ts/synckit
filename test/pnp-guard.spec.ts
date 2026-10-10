import fs from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import * as workerThreads from 'node:worker_threads'

import { jest } from '@jest/globals'
import * as pkgrCore from '@pkgr/core'

import { _dirname } from './helpers.js'

// https://github.com/un-ts/synckit/issues/278
//
// Under Yarn PnP the package lives inside a zip archive, so `register.cjs` cannot be read until
// `.pnp.cjs` has patched module resolution. The guard therefore has to sit *behind* the PnP API
// require in the worker's own `NODE_OPTIONS`, and the "already inherited" check has to find it
// there rather than only at the first argument. These tests start no thread: the worker
// constructor is captured directly, which is what makes the exact ordering observable.

// per run, so a parallel suite cannot see this one's files and the cleanup cannot remove its own
const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'synckit-pnp-guard-'))
const workerPreloadPath = path.resolve(_dirname, '../register.cjs')
const pnpApiPath = path.join(fixtureDir, 'pnpapi.cjs')
const inheritedPreload = path.join(fixtureDir, 'inherited-preload.cjs')

interface CapturedOptions {
  env?: { NODE_OPTIONS?: string }
  execArgv?: string[]
}

const captured: Array<{ entry: unknown; options: CapturedOptions }> = []

class FakeWorker {
  unref = jest.fn()

  constructor(entry: unknown, options: CapturedOptions) {
    captured.push({ entry, options })
  }
}

class FakeMessageChannel {
  port1 = { off: jest.fn(), on: jest.fn(), postMessage: jest.fn() }
  port2 = { off: jest.fn(), on: jest.fn(), postMessage: jest.fn() }
}

const realRequire = createRequire(import.meta.url)

const fakeRequire = Object.assign(
  (id: string): unknown => realRequire(id),
  realRequire,
  {
    resolve: (id: string) =>
      id === 'pnpapi' ? pnpApiPath : realRequire.resolve(id),
  },
)

/**
 * Re-imports the package with the PnP runtime faked, so `setupTsRunner` resolves `pnpapi` and
 * `startWorkerThread` writes a worker environment. `NODE_OPTIONS` is read when the module loads, so
 * it has to be in place before the import.
 *
 * @param nodeOptions - The `NODE_OPTIONS` this process "inherited".
 * @param pnp - Whether the PnP runtime reports itself, as `process.versions.pnp` does.
 */
const importWithRuntime = async (nodeOptions: string, pnp: boolean) => {
  jest.resetModules()

  jest.unstable_mockModule('node:worker_threads', () => ({
    ...workerThreads,
    MessageChannel: FakeMessageChannel,
    Worker: FakeWorker,
  }))

  jest.unstable_mockModule('@pkgr/core', () => ({
    ...pkgrCore,
    cjsRequire: fakeRequire,
  }))

  process.env.NODE_OPTIONS = nodeOptions
  if (pnp) {
    ;(process.versions as { pnp?: string }).pnp = '3'
  } else {
    delete (process.versions as { pnp?: string }).pnp
  }

  return import('synckit')
}

const previousNodeOptions = process.env.NODE_OPTIONS
const previousPnp = (process.versions as { pnp?: string }).pnp

beforeAll(() => {
  // requiring it is a no-op; it stands in for the real `.pnp.cjs` the runtime loads
  fs.writeFileSync(pnpApiPath, '')
  fs.writeFileSync(inheritedPreload, '')
})

afterAll(() => {
  fs.rmSync(fixtureDir, { recursive: true, force: true })
})

beforeEach(() => {
  captured.length = 0
})

afterEach(() => {
  if (previousNodeOptions == null) {
    delete process.env.NODE_OPTIONS
  } else {
    process.env.NODE_OPTIONS = previousNodeOptions
  }
  if (previousPnp == null) {
    delete (process.versions as { pnp?: string }).pnp
  } else {
    ;(process.versions as { pnp?: string }).pnp = previousPnp
  }
  jest.resetModules()
})

test('under PnP the guard is preloaded after the PnP API require', async () => {
  const { createSyncFn } = await importWithRuntime(
    `-r ${JSON.stringify(inheritedPreload)}`,
    true,
  )

  createSyncFn(path.join(os.tmpdir(), 'synckit-pnp-guard-primary.cjs'))

  // the PnP API first — the archive is unreadable without it — then the guard, then everything the
  // project inherited, so a failure in an inherited preload is still reported
  const options = captured.at(-1)!.options
  expect(options.env!.NODE_OPTIONS).toBe(
    `-r ${JSON.stringify(pnpApiPath)} -r ${JSON.stringify(workerPreloadPath)} -r ${JSON.stringify(inheritedPreload)}`,
  )
  // and only there: `NODE_OPTIONS` runs before `execArgv`, so the API must not be required twice
  expect(options.execArgv).not.toContain(pnpApiPath)
})

test('a guard already inherited behind the PnP require is not prepended again', async () => {
  const { createSyncFn } = await importWithRuntime(
    `-r ${JSON.stringify(pnpApiPath)} -r ${JSON.stringify(workerPreloadPath)}`,
    true,
  )

  createSyncFn(path.join(os.tmpdir(), 'synckit-pnp-guard-inherited.cjs'))

  // the environment is inherited untouched; the guard rides along in `execArgv` for a caller that
  // clears the variable, and the PnP API still leads it there because the archive stays unreadable
  // until the API has patched resolution
  const options = captured.at(-1)!.options
  expect(options.env).toBeUndefined()
  const [pnpFlag, pnpValue, guardFlag, guardValue] = options.execArgv!
  expect([pnpFlag, pnpValue, guardFlag, guardValue]).toEqual([
    '-r',
    pnpApiPath,
    '-r',
    workerPreloadPath,
  ])
})

test('a guard behind another preload is not treated as protective', async () => {
  const { createSyncFn } = await importWithRuntime(
    `-r ${JSON.stringify(inheritedPreload)} -r ${JSON.stringify(workerPreloadPath)}`,
    true,
  )

  createSyncFn(path.join(os.tmpdir(), 'synckit-pnp-guard-late.cjs'))

  // `inheritedPreload` runs before the inherited guard, so a failure in it would be reported by
  // nothing. The guard is written ahead of it instead of leaving the late pair in place
  const options = captured.at(-1)!.options
  expect(options.env!.NODE_OPTIONS).toBe(
    `-r ${JSON.stringify(pnpApiPath)} -r ${JSON.stringify(workerPreloadPath)} ` +
      `-r ${JSON.stringify(inheritedPreload)} -r ${JSON.stringify(workerPreloadPath)}`,
  )
})

test('without PnP the guard still leads and no PnP require is added', async () => {
  const { createSyncFn } = await importWithRuntime(
    `-r ${JSON.stringify(inheritedPreload)}`,
    false,
  )

  createSyncFn(path.join(os.tmpdir(), 'synckit-pnp-guard-non-pnp.cjs'))

  expect(captured.at(-1)!.options.env!.NODE_OPTIONS).toBe(
    `-r ${JSON.stringify(workerPreloadPath)} -r ${JSON.stringify(inheritedPreload)}`,
  )
})
