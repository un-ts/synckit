import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { _dirname } from './helpers.js'

import { createSyncFn } from 'synckit'
import type { AnyFn, SynckitOptions } from 'synckit'

// The workers run in a real process, so they load the built `lib`, as the other
// worker fixtures do. Always pass an explicit timeout: without one a regression
// would block the test thread in `Atomics.wait()` forever instead of failing.
const TIMEOUT = 5000

const workerLibPath = path.resolve(_dirname, '../lib/index.cjs')
const workerLibUrl = pathToFileURL(
  path.resolve(_dirname, '../lib/index.js'),
).href

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

/**
 * A worker body whose first call throws at 20ms but which still answers at 100ms, so a handler
 * left in place can decide whether it survives. `extra` is prepended, for such a handler.
 */
const throwOnFirstCallWorker = (message: string, extra = '') =>
  cjsWorker(
    `${extra}runAsWorker(
  value =>
    new Promise(resolve => {
      if (value === 1) {
        setTimeout(() => {
          throw new Error(${JSON.stringify(message)})
        }, 20)
      }
      setTimeout(() => resolve(value), 100)
    }),
)`,
  )

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

/** Writes the worker from this body, and returns the synchronous function its caller gets. */
const syncFnFor = <T extends AnyFn>(
  name: string,
  body: string,
  options: Omit<SynckitOptions, 'timeout'> = {},
) => createSyncFn<T>(writeWorker(name, body), { ...options, timeout: TIMEOUT })

/** The message of the failure the call reports. */
const failureOf = (syncFn: AnyFn, ...args: unknown[]) =>
  expectThrows(() => syncFn(...args)).message

test('ESM worker with a missing top-level import throws instead of hanging', () => {
  const syncFn = syncFnFor<() => unknown>(
    'missing-import.mjs',
    esmWorker(`import 'no-such-package-for-synckit-test'\n${identityWorker}`),
  )

  const error = expectThrows(() => syncFn())
  expect(error.code).toBe('ERR_MODULE_NOT_FOUND')
  expect(error.message).toContain('no-such-package-for-synckit-test')

  // later calls keep throwing the original error instead of hanging
  expect(expectThrows(() => syncFn()).code).toBe('ERR_MODULE_NOT_FOUND')
})

test('CommonJS worker with a missing require throws instead of hanging', () => {
  const syncFn = syncFnFor<() => unknown>(
    'missing-require.cjs',
    cjsWorker(`require('no-such-package-for-synckit-test')\n${identityWorker}`),
  )

  const error = expectThrows(() => syncFn())
  expect(error.code).toBe('MODULE_NOT_FOUND')
  expect(error.message).toContain('no-such-package-for-synckit-test')
})

test('worker with a syntax error throws instead of hanging', () => {
  const syncFn = syncFnFor<() => unknown>(
    'syntax-error.mjs',
    `import { runAsWorker } from '${workerLibUrl}'\nrunAsWorker(() => {\n  const = 1\n})\n`,
  )

  expect(expectThrows(() => syncFn()).name).toBe('SyntaxError')
})

test('a falsy thrown load failure is surfaced as it is', () => {
  const syncFn = syncFnFor<() => unknown>(
    'throw-undefined.cjs',
    'throw undefined\n',
  )

  let threw = false
  let caught: unknown
  try {
    syncFn()
  } catch (error) {
    threw = true
    caught = error
  }

  // a present-but-undefined reason is a failure, not a result
  expect(threw).toBe(true)
  expect(caught).toBeUndefined()
})

test('worker paths containing a quote are not broken by source generation', () => {
  // a global shim forces the generated bootstrap, which embeds the worker path in source: the eval
  // entry for CommonJS, the data URL for ESM. Without it the path is passed as a URL and nothing
  // is generated, so the quote never reaches a parser
  const globalShims = [{ moduleName: 'node:perf_hooks' }]

  const fromCjs = syncFnFor<(value: number) => number>(
    "worker-quote'.cjs",
    cjsWorker(identityWorker),
    { globalShims },
  )
  expect(fromCjs(1)).toBe(1)

  const fromEsm = syncFnFor<(value: number) => number>(
    "worker-quote'.mjs",
    esmWorker(identityWorker),
    { globalShims },
  )
  expect(fromEsm(2)).toBe(2)
})

// ESM workers keep a real module file as their entry, so `--input-type` does not apply to
// them (Node rejects it for file input, as it did before this change). The CommonJS
// bootstrap is parsed the same either way, which is what this covers.
test('a custom --input-type=module does not break CommonJS workers', () => {
  const syncFn = syncFnFor<(value: number) => number>(
    'input-type.cjs',
    cjsWorker(identityWorker),
    { execArgv: ['--input-type=module'] },
  )

  expect(syncFn(2)).toBe(2)
})

test('a userland --require preload still runs', () => {
  const userPreload = writeWorker(
    'user-preload.cjs',
    `globalThis.__userPreload = 'ran'`,
  )
  const syncFn = syncFnFor<() => string>(
    'uses-user-preload.cjs',
    cjsWorker(`runAsWorker(() => globalThis.__userPreload)`),
    { execArgv: ['-r', userPreload] },
  )

  expect(syncFn()).toBe('ran')
})

test('a throwing userland preload is reported instead of hanging', () => {
  const userPreload = writeWorker(
    'throwing-preload.cjs',
    `throw new Error('preload boom')`,
  )
  const syncFn = syncFnFor<() => unknown>(
    'unused-worker.cjs',
    cjsWorker(identityWorker),
    { execArgv: ['-r', userPreload] },
  )

  expect(failureOf(syncFn)).toContain('preload boom')
})

test('a failure in a preload inherited from NODE_OPTIONS is reported', () => {
  // it throws off the main thread only, so it can be inherited by the test process itself without
  // taking it down
  const inheritedPreload = writeWorker(
    'inherited-preload.cjs',
    `if (!require('node:worker_threads').isMainThread) {
  throw new Error('inherited preload boom')
}`,
  )
  const previousNodeOptions = process.env.NODE_OPTIONS
  process.env.NODE_OPTIONS = `--require ${JSON.stringify(inheritedPreload)}`
  try {
    const syncFn = syncFnFor<() => unknown>(
      'unused-inherited-worker.cjs',
      cjsWorker(identityWorker),
    )

    expect(failureOf(syncFn)).toContain('inherited preload boom')
  } finally {
    if (previousNodeOptions == null) {
      delete process.env.NODE_OPTIONS
    } else {
      process.env.NODE_OPTIONS = previousNodeOptions
    }
  }
})

test('a failing global shim throws instead of hanging', () => {
  const esmShim = writeWorker('boom-shim.mjs', `throw new Error('BOOM_ESM')\n`)
  const esmSyncFn = syncFnFor<(value: number) => number>(
    'with-esm-shim.mjs',
    esmWorker(identityWorker),
    { globalShims: [{ moduleName: esmShim }] },
  )
  expect(failureOf(esmSyncFn, 1)).toContain('BOOM_ESM')

  const cjsShim = writeWorker('boom-shim.cjs', `throw new Error('BOOM_CJS')\n`)
  const cjsSyncFn = syncFnFor<(value: number) => number>(
    'with-cjs-shim.cjs',
    cjsWorker(identityWorker),
    { globalShims: [{ moduleName: cjsShim }] },
  )
  expect(failureOf(cjsSyncFn, 1)).toContain('BOOM_CJS')
})

test('global shims still apply', () => {
  const syncFn = syncFnFor<() => string>(
    'uses-global-shim.mjs',
    esmWorker(`runAsWorker(() => typeof globalThis.performance)`),
    {
      globalShims: [
        {
          moduleName: 'node:perf_hooks',
          globalName: 'performance',
          named: 'performance',
        },
      ],
    },
  )

  expect(syncFn()).toBe('object')
})

test('a worker load failure does not consume another worker notification', () => {
  const failing = syncFnFor<() => unknown>(
    'failing-worker.cjs',
    `require('no-such-package-for-synckit-test')\n`,
  )
  const healthy = syncFnFor<(ms: number) => number>(
    'healthy-worker.cjs',
    cjsWorker(
      `runAsWorker(ms => new Promise(resolve => setTimeout(() => resolve(ms), ms)))`,
    ),
  )

  // the healthy worker is awaited while the failing one reports its load failure
  expect(healthy(500)).toBe(500)
  expect(expectThrows(() => failing()).code).toBe('MODULE_NOT_FOUND')
})

test('a worker that registers and then throws is still reported', () => {
  // registering is not the end of the module: a top-level throw after it would otherwise
  // leave the caller waiting in `Atomics.wait()`
  const syncFn = syncFnFor<() => unknown>(
    'registers-then-throws.cjs',
    cjsWorker(`${identityWorker}\nthrow new Error('boom after registering')`),
  )

  expect(failureOf(syncFn)).toContain('boom after registering')
})

test('a primitive load failure is thrown as it is, not boxed', () => {
  const syncFn = syncFnFor<() => unknown>(
    'throws-a-primitive.cjs',
    `throw 'primitive boom'\n`,
  )

  let caught: unknown
  try {
    syncFn()
  } catch (error) {
    caught = error
  }

  // merging the copied properties used to box it into a `String` with no `message`
  expect(caught).toBe('primitive boom')
})

test('an ESM worker that throws after a top-level await is reported', () => {
  // nothing signals that a top-level `await` is still pending, so the module can be marked
  // loaded while it is still evaluating: the failure has to be reported regardless
  const syncFn = syncFnFor<() => unknown>(
    'throws-after-top-level-await.mjs',
    esmWorker(
      `runAsWorker(() => new Promise(resolve => setTimeout(() => resolve('late'), 300)))
await new Promise(resolve => setTimeout(resolve, 50))
throw new Error('boom after a top-level await')`,
    ),
  )

  expect(failureOf(syncFn)).toContain('boom after a top-level await')
})

test('a runtime failure while a call is in flight is reported', () => {
  const syncFn = syncFnFor<() => unknown>(
    'throws-while-serving.cjs',
    cjsWorker(
      `runAsWorker(() => new Promise(resolve => setTimeout(() => resolve('late'), 300)))
setTimeout(() => {
  throw new Error('boom while a call is in flight')
}, 50)`,
    ),
  )

  expect(failureOf(syncFn)).toContain('boom while a call is in flight')
})

test('a worker that recovers through its own handler keeps serving', () => {
  const syncFn = syncFnFor<(value: number) => number>(
    'recovers.cjs',
    throwOnFirstCallWorker(
      'recovered by the worker',
      `process.on('uncaughtException', () => {})\n\n`,
    ),
  )

  // the failure reaches the caller of the call that was in flight ...
  expect(failureOf(syncFn, 1)).toContain('recovered by the worker')
  // ... but the worker recovered, so the next call still reaches it
  expect(syncFn(2)).toBe(2)
})

test('a registered worker with nothing left to handle it is written off', () => {
  const syncFn = syncFnFor<(value: number) => number>(
    'unhandled-runtime-failure.cjs',
    throwOnFirstCallWorker('unhandled runtime boom'),
  )

  expect(failureOf(syncFn, 1)).toContain('unhandled runtime boom')
  // nothing recovered it, so the worker is written off rather than reused
  expect(failureOf(syncFn, 2)).toContain('unhandled runtime boom')
})

test('a worker that exits while a call is in flight is reported', () => {
  const syncFn = syncFnFor<() => unknown>(
    'exits-while-serving.cjs',
    cjsWorker(
      `runAsWorker(
  () =>
    new Promise(() => {
      setTimeout(() => process.exit(2), 20)
    }),
)`,
    ),
  )

  expect(failureOf(syncFn)).toContain('Worker exited with code 2')
})

test('a worker whose own handler exits is not waited on', () => {
  const syncFn = syncFnFor<(value: number) => number>(
    'exits-in-its-own-handler.cjs',
    throwOnFirstCallWorker(
      'handled by exiting',
      `process.on('uncaughtException', () => process.exit(1))\n\n`,
    ),
  )

  // the failure itself is reported first, because the handler is still installed
  expect(failureOf(syncFn, 1)).toContain('handled by exiting')
  // and then the exit is, so the next call fails instead of waiting on a stopped worker
  expect(failureOf(syncFn, 2)).toContain('Worker exited with code 1')
})

test('a fatal failure stops the worker instead of letting it keep running', async () => {
  // the marker timer fires only if the worker's event loop is still alive, so the file is proof
  // that the worker was stopped rather than merely written off by the caller
  const marker = path.join(tmpdir, 'fatally-alive.marker')
  const syncFn = syncFnFor<(value: number) => number>(
    'fatal-keeps-running.cjs',
    throwOnFirstCallWorker(
      'fatal boom',
      `const fs = require('node:fs')
setTimeout(() => fs.writeFileSync(${JSON.stringify(marker)}, 'alive'), 500)

`,
    ),
  )

  expect(failureOf(syncFn, 1)).toContain('fatal boom')

  await new Promise(resolve => setTimeout(resolve, 1000))
  expect(fs.existsSync(marker)).toBe(false)
})

test('an uncaught exception is fatal even with only a rejection listener', async () => {
  // the worker's only listener is for the other event, which cannot handle an uncaught exception
  const marker = path.join(tmpdir, 'rejection-listener-only.marker')
  const syncFn = syncFnFor<(value: number) => number>(
    'rejection-listener-only.cjs',
    throwOnFirstCallWorker(
      'cross-event boom',
      `const fs = require('node:fs')
process.on('unhandledRejection', () => {})
setTimeout(() => fs.writeFileSync(${JSON.stringify(marker)}, 'alive'), 500)

`,
    ),
  )

  expect(failureOf(syncFn, 1)).toContain('cross-event boom')
  // fatal, so the failure is cached and the worker is not reused
  expect(failureOf(syncFn, 2)).toContain('cross-event boom')

  await new Promise(resolve => setTimeout(resolve, 1000))
  expect(fs.existsSync(marker)).toBe(false)
})

test('a worker that fails while no call is waiting stops itself', async () => {
  const marker = path.join(tmpdir, 'idle-fatal.marker')
  const syncFn = syncFnFor<() => unknown>(
    'idle-fatal.cjs',
    cjsWorker(`const fs = require('node:fs')
setTimeout(() => fs.writeFileSync(${JSON.stringify(marker)}, 'alive'), 500)
setTimeout(() => {
  throw new Error('idle fatal boom')
}, 20)
${identityWorker}`),
  )

  // no caller is waiting to consume the report, so only the worker can stop itself
  await new Promise(resolve => setTimeout(resolve, 1000))
  expect(fs.existsSync(marker)).toBe(false)

  // the report was queued anyway, so the next caller still receives it
  expect(failureOf(syncFn)).toContain('idle fatal boom')
})

test('a reason that cannot be stringified still delivers a message', async () => {
  const marker = path.join(tmpdir, 'unstringifiable.marker')
  const syncFn = syncFnFor<() => unknown>(
    'unstringifiable.cjs',
    cjsWorker(`const fs = require('node:fs')
const boom = {
  // an enumerable function defeats cloning of both explicit payloads
  fn: () => {},
  get message() {
    throw new Error('no message')
  },
  // and a throwing conversion defeats the synthetic one
  toString() {
    throw new Error('no string')
  },
}
setTimeout(() => fs.writeFileSync(${JSON.stringify(marker)}, 'alive'), 500)

runAsWorker(
  () =>
    new Promise(resolve => {
      setTimeout(() => resolve('late'), 400)
      setTimeout(() => {
        throw boom
      }, 20)
    }),
)`),
  )

  // the named synthetic cannot read the reason either, so the constant one is what crosses. This
  // worker did reach `runAsWorker`, so it failed while serving, not while loading
  expect(failureOf(syncFn)).toBe('Worker failed')

  await new Promise(resolve => setTimeout(resolve, 1000))
  expect(fs.existsSync(marker)).toBe(false)
})

test('an unhandled rejection is recoverable through an uncaughtException handler', () => {
  const syncFn = syncFnFor<(value: number) => number>(
    'rejection-recovered.cjs',
    cjsWorker(
      `process.on('uncaughtException', () => {})

runAsWorker(
  value =>
    new Promise(resolve => {
      if (value === 1) {
        Promise.reject(new Error('recovered rejection'))
      }
      setTimeout(() => resolve(value), 100)
    }),
)`,
    ),
  )

  // the rejection reaches the caller of the call in flight ...
  expect(failureOf(syncFn, 1)).toContain('recovered rejection')
  // ... but under the default mode Node would promote a later one to the uncaughtException
  // handler, so the worker keeps serving
  expect(syncFn(2)).toBe(2)
})

test('a later failure on a recovered worker is reported too', () => {
  const syncFn = syncFnFor<(value: number) => number>(
    'recovered-twice.cjs',
    cjsWorker(
      `process.on('uncaughtException', () => {})

runAsWorker(
  value =>
    new Promise(resolve => {
      if (value === 1) {
        setTimeout(() => resolve(value), 100)
      }
      setTimeout(() => {
        throw new Error(\`boom \${value}\`)
      }, 20)
    }),
)`,
    ),
  )

  expect(failureOf(syncFn, 1)).toContain('boom 1')
  // the worker recovered, so the guard armed again; without that the second failure would be
  // swallowed by the worker's own handler and this call would wait out its deadline
  expect(failureOf(syncFn, 2)).toContain('boom 2')
})

test('execArgv from the options sets the rejection mode the guard sees', () => {
  const body = cjsWorker(
    `runAsWorker(
  value =>
    new Promise(resolve => {
      if (value === 1) {
        Promise.reject(new Error('warned rejection'))
      }
      setTimeout(() => resolve(value), 100)
    }),
)`,
  )

  // the option becomes the worker's own `execArgv`, which the guard reads
  const warned = syncFnFor<(value: number) => number>('warned.cjs', body, {
    execArgv: ['--unhandled-rejections=warn'],
  })
  expect(failureOf(warned, 1)).toContain('warned rejection')
  // `warn` leaves the worker serving, so the next call is answered
  expect(warned(2)).toBe(2)

  // without it the default `throw` stops the worker, and later calls keep throwing that failure
  const thrown = syncFnFor<(value: number) => number>('thrown.cjs', body)
  expect(failureOf(thrown, 1)).toContain('warned rejection')
  expect(failureOf(thrown, 2)).toContain('warned rejection')
})
