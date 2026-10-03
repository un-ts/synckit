import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { createSyncFn } from 'synckit'

// The workers run in a real process, so they load the built `lib`, as the other
// worker fixtures do. Always pass an explicit timeout: without one a regression
// would block the test thread in `Atomics.wait()` forever instead of failing.
const TIMEOUT = 5000

const workerLibPath = path.resolve('lib/index.cjs')
const workerLibUrl = pathToFileURL(path.resolve('lib/index.js')).href

let tmpdir: string

beforeAll(() => {
  tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'synckit-worker-load-'))
})

afterAll(() => {
  fs.rmSync(tmpdir, { recursive: true, force: true })
})

const writeWorker = (name: string, content: string) => {
  const workerPath = path.join(tmpdir, name)
  fs.writeFileSync(workerPath, content)
  return workerPath
}

const esmWorker = (body: string) =>
  `import { runAsWorker } from '${workerLibUrl}'\n${body}\n`

const cjsWorker = (body: string) =>
  `const { runAsWorker } = require(${JSON.stringify(workerLibPath)})\n${body}\n`

const identityWorker = `runAsWorker(value => value)`

const expectThrows = (fn: () => unknown) => {
  let caught: unknown
  try {
    fn()
  } catch (error) {
    caught = error
  }
  // errors cross the worker boundary through a structured clone, so they belong to a
  // different realm and `instanceof Error` would not hold: assert on the shape instead
  expect(caught).toHaveProperty('message', expect.any(String))
  return caught as Error & { code?: string }
}

test('ESM worker with a missing top-level import throws instead of hanging', () => {
  const workerPath = writeWorker(
    'missing-import.mjs',
    esmWorker(`import 'no-such-package-for-synckit-test'\n${identityWorker}`),
  )
  const syncFn = createSyncFn<() => unknown>(workerPath, { timeout: TIMEOUT })

  const error = expectThrows(() => syncFn())
  expect(error.code).toBe('ERR_MODULE_NOT_FOUND')
  expect(error.message).toContain('no-such-package-for-synckit-test')

  // later calls keep throwing the original error instead of hanging
  expect(expectThrows(() => syncFn()).code).toBe('ERR_MODULE_NOT_FOUND')
})

test('CommonJS worker with a missing require throws instead of hanging', () => {
  const workerPath = writeWorker(
    'missing-require.cjs',
    cjsWorker(`require('no-such-package-for-synckit-test')\n${identityWorker}`),
  )
  const syncFn = createSyncFn<() => unknown>(workerPath, { timeout: TIMEOUT })

  const error = expectThrows(() => syncFn())
  expect(error.code).toBe('MODULE_NOT_FOUND')
  expect(error.message).toContain('no-such-package-for-synckit-test')
})

test('worker with a syntax error throws instead of hanging', () => {
  const workerPath = writeWorker(
    'syntax-error.mjs',
    `import { runAsWorker } from '${workerLibUrl}'\nrunAsWorker(() => {\n  const = 1\n})\n`,
  )
  const syncFn = createSyncFn<() => unknown>(workerPath, { timeout: TIMEOUT })

  expect(expectThrows(() => syncFn()).name).toBe('SyntaxError')
})

test('a falsy thrown load failure is still surfaced', () => {
  const workerPath = writeWorker('throw-undefined.cjs', 'throw undefined\n')
  const syncFn = createSyncFn<() => unknown>(workerPath, { timeout: TIMEOUT })

  expect(expectThrows(() => syncFn()).message).toBe(
    'Worker module failed to load',
  )
})

test('worker paths containing a quote are not broken by source generation', () => {
  const cjsPath = writeWorker("worker-quote'.cjs", cjsWorker(identityWorker))
  expect(
    createSyncFn<(value: number) => number>(cjsPath, { timeout: TIMEOUT })(1),
  ).toBe(1)

  const esmPath = writeWorker("worker-quote'.mjs", esmWorker(identityWorker))
  expect(
    createSyncFn<(value: number) => number>(esmPath, { timeout: TIMEOUT })(2),
  ).toBe(2)
})

// ESM workers keep a real module file as their entry, so `--input-type` does not apply to
// them (Node rejects it for file input, as it did before this change). The CommonJS
// bootstrap is parsed the same either way, which is what this covers.
test('a custom --input-type=module does not break CommonJS workers', () => {
  const cjsPath = writeWorker('input-type.cjs', cjsWorker(identityWorker))
  expect(
    createSyncFn<(value: number) => number>(cjsPath, {
      execArgv: ['--input-type=module'],
      timeout: TIMEOUT,
    })(2),
  ).toBe(2)
})

test('a userland --require preload still runs', () => {
  const userPreload = writeWorker(
    'user-preload.cjs',
    `globalThis.__userPreload = 'ran'`,
  )
  const workerPath = writeWorker(
    'uses-user-preload.cjs',
    cjsWorker(`runAsWorker(() => globalThis.__userPreload)`),
  )
  const syncFn = createSyncFn<() => string>(workerPath, {
    execArgv: ['-r', userPreload],
    timeout: TIMEOUT,
  })

  expect(syncFn()).toBe('ran')
})

test('a throwing userland preload is reported instead of hanging', () => {
  const userPreload = writeWorker(
    'throwing-preload.cjs',
    `throw new Error('preload boom')`,
  )
  const workerPath = writeWorker('unused-worker.cjs', cjsWorker(identityWorker))
  const syncFn = createSyncFn<() => unknown>(workerPath, {
    execArgv: ['-r', userPreload],
    timeout: TIMEOUT,
  })

  expect(expectThrows(() => syncFn()).message).toContain('preload boom')
})

test('a failing global shim throws instead of hanging', () => {
  const esmShim = writeWorker('boom-shim.mjs', `throw new Error('BOOM_ESM')\n`)
  const esmPath = writeWorker('with-esm-shim.mjs', esmWorker(identityWorker))
  const esmSyncFn = createSyncFn<(value: number) => number>(esmPath, {
    globalShims: [{ moduleName: esmShim }],
    timeout: TIMEOUT,
  })
  expect(expectThrows(() => esmSyncFn(1)).message).toContain('BOOM_ESM')

  const cjsShim = writeWorker('boom-shim.cjs', `throw new Error('BOOM_CJS')\n`)
  const cjsPath = writeWorker('with-cjs-shim.cjs', cjsWorker(identityWorker))
  const cjsSyncFn = createSyncFn<(value: number) => number>(cjsPath, {
    globalShims: [{ moduleName: cjsShim }],
    timeout: TIMEOUT,
  })
  expect(expectThrows(() => cjsSyncFn(1)).message).toContain('BOOM_CJS')
})

test('global shims still apply', () => {
  const workerPath = writeWorker(
    'uses-global-shim.mjs',
    esmWorker(`runAsWorker(() => typeof globalThis.performance)`),
  )
  const syncFn = createSyncFn<() => string>(workerPath, {
    globalShims: [
      {
        moduleName: 'node:perf_hooks',
        globalName: 'performance',
        named: 'performance',
      },
    ],
    timeout: TIMEOUT,
  })

  expect(syncFn()).toBe('object')
})

test('a worker load failure does not consume another worker notification', () => {
  const failingPath = writeWorker(
    'failing-worker.cjs',
    `require('no-such-package-for-synckit-test')\n`,
  )
  const healthyPath = writeWorker(
    'healthy-worker.cjs',
    cjsWorker(
      `runAsWorker(ms => new Promise(resolve => setTimeout(() => resolve(ms), ms)))`,
    ),
  )

  const failing = createSyncFn<() => unknown>(failingPath, { timeout: TIMEOUT })
  const healthy = createSyncFn<(ms: number) => number>(healthyPath, {
    timeout: TIMEOUT,
  })

  // the healthy worker is awaited while the failing one reports its load failure
  expect(healthy(500)).toBe(500)
  expect(expectThrows(() => failing()).code).toBe('MODULE_NOT_FOUND')
})

test('a worker that registers and then throws is still reported', () => {
  // registering is not the end of the module: a top-level throw after it would otherwise
  // leave the caller waiting in `Atomics.wait()`
  const workerPath = writeWorker(
    'registers-then-throws.cjs',
    cjsWorker(`${identityWorker}\nthrow new Error('boom after registering')`),
  )
  const syncFn = createSyncFn<() => unknown>(workerPath, { timeout: TIMEOUT })

  expect(expectThrows(() => syncFn()).message).toContain(
    'boom after registering',
  )
})

test('a primitive load failure is surfaced as an Error', () => {
  const workerPath = writeWorker(
    'throws-a-primitive.cjs',
    `throw 'primitive boom'\n`,
  )
  const syncFn = createSyncFn<() => unknown>(workerPath, { timeout: TIMEOUT })

  const error = expectThrows(() => syncFn())
  // a boxed primitive would carry no message at all
  expect(error.constructor.name).toBe('Error')
  expect(error.message).toContain('primitive boom')
})
