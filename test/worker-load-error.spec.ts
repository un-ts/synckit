import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { jest } from '@jest/globals'

import { _dirname } from './helpers.js'

import {
  DEFAULT_TIMEOUT,
  REQUIRE_ABBR_FLAG,
  TsRunner,
  createSyncFn,
} from 'synckit'
import type { AnyFn, SynckitOptions } from 'synckit'

// The workers run in a real process, so they load the built `lib`, as the other
// worker fixtures do. Always pass an explicit timeout: without one a regression
// would block the test thread in `Atomics.wait()` forever instead of failing.
const TIMEOUT = 5000

const workerLibPath = path.resolve(_dirname, '../lib/index.cjs')
const workerPreloadPath = path.resolve(_dirname, '../register.cjs')
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

test('a synckit worker nested in a worker keeps one guard preload', () => {
  const preloadCount = `const preloadCount = () =>
  (process.env.NODE_OPTIONS || '').split('register.cjs').length - 1`

  const inner = writeWorker(
    'nested-inner.cjs',
    cjsWorker(`${preloadCount}
runAsWorker(preloadCount)`),
  )
  const outer = writeWorker(
    'nested-outer.cjs',
    `const { createSyncFn, runAsWorker } = require(${JSON.stringify(workerLibPath)})
${preloadCount}
const inner = createSyncFn(${JSON.stringify(inner)}, ${TIMEOUT})
runAsWorker(() => ({ outer: preloadCount(), inner: inner() }))`,
  )

  const syncFn = createSyncFn<() => { outer: number; inner: number }>(outer, {
    timeout: TIMEOUT,
  })

  // the guard leads the worker's `NODE_OPTIONS`, but only when that worker does not inherit it
  // already: otherwise every nesting level would add another `--require`
  expect(syncFn()).toEqual({ outer: 1, inner: 1 })
})

test('a worker starts when NODE_OPTIONS holds an option it rejects', () => {
  // Node 18 refuses an inherited option like this one once the environment is passed explicitly to a
  // worker (`ERR_WORKER_INVALID_EXEC_ARGV`), which the fallback covers; Node 20 and later accept it,
  // so there the test passes on the primary path. `process.env` is read when the worker is created
  const previousNodeOptions = process.env.NODE_OPTIONS
  process.env.NODE_OPTIONS = '--openssl-legacy-provider'
  try {
    const syncFn = syncFnFor<(value: number) => number>(
      'legacy-provider.cjs',
      cjsWorker(identityWorker),
    )

    expect(syncFn(1)).toBe(1)
  } finally {
    if (previousNodeOptions == null) {
      delete process.env.NODE_OPTIONS
    } else {
      process.env.NODE_OPTIONS = previousNodeOptions
    }
  }
})

test('a nested worker still gets the guard when the outer took the fallback', () => {
  // Node 18 only: the rejected option forces the fallback at level 1, and that guard lives in the
  // outer worker's `execArgv`, which the inner worker does not inherit — so it has to be added
  // again. Node 20 and later accept the option, where this passes on the primary path
  const previousNodeOptions = process.env.NODE_OPTIONS
  process.env.NODE_OPTIONS = '--openssl-legacy-provider'
  try {
    const inner = writeWorker(
      'fallback-inner.cjs',
      `throw new Error('fallback inner load boom')`,
    )
    const outer = writeWorker(
      'fallback-outer.cjs',
      `const { createSyncFn, runAsWorker } = require(${JSON.stringify(workerLibPath)})
const inner = createSyncFn(${JSON.stringify(inner)}, ${TIMEOUT})
runAsWorker(() => {
  try {
    inner()
    return 'no failure'
  } catch (error) {
    return String(error && error.message)
  }
})`,
    )

    const syncFn = createSyncFn<() => string>(outer, { timeout: TIMEOUT })

    // a module that throws before it can require synckit is only reported by the preload guard
    expect(syncFn()).toContain('fallback inner load boom')
  } finally {
    if (previousNodeOptions == null) {
      delete process.env.NODE_OPTIONS
    } else {
      process.env.NODE_OPTIONS = previousNodeOptions
    }
  }
})

test('a guard path that is another flag value does not count as preloaded', () => {
  // `--conditions` carries the guard's path as its value. The check looks at the leading arguments,
  // so it must not be satisfied and the prepend still has to happen: the worker's module then fails
  // to load, and only the guard can report why. The variable is set when the child starts, which is
  // when `NODE_OPTIONS` is fixed — a value set later would not reach the parsed array anyway
  const loadFailingWorker = writeWorker(
    'conditions-value.cjs',
    `throw new Error('conditions value boom')`,
  )
  const probe = writeWorker(
    'conditions-probe.cjs',
    `const { createSyncFn } = require(${JSON.stringify(workerLibPath)})
try {
  createSyncFn(${JSON.stringify(loadFailingWorker)}, ${TIMEOUT})()
  process.stdout.write('no failure')
} catch (error) {
  process.stdout.write(String(error && error.message))
}`,
  )

  const output = execFileSync(process.execPath, [probe], {
    encoding: 'utf8',
    env: {
      ...process.env,
      NODE_OPTIONS: `--conditions ${JSON.stringify(workerPreloadPath)}`,
    },
  })

  expect(output).toContain('conditions value boom')
})

test('a message delivered after its notification still wakes the caller', () => {
  // the state the measured race produces, made deterministic: the notification is bumped at worker
  // startup, and the message it announces is posted 300ms later with no notification of its own —
  // longer than the spin bound, so the loop reaches its slice sleep before the message is readable
  const lateWorker = writeWorker(
    'late-message.cjs',
    `const { parentPort, workerData } = require('node:worker_threads')
const { NOTIFY_INDEX } = require(${JSON.stringify(path.resolve(_dirname, '../shared.cjs'))})
const { sharedBufferView, workerPort } = workerData
Atomics.add(sharedBufferView, NOTIFY_INDEX, 1)
Atomics.notify(sharedBufferView, NOTIFY_INDEX)
parentPort.on('message', ({ id }) => {
  setTimeout(() => {
    workerPort.postMessage({ id, stdio: [], result: 'late ' + id })
  }, 300)
})`,
  )
  const probe = writeWorker(
    'late-message-probe.cjs',
    `const { createSyncFn } = require(${JSON.stringify(workerLibPath)})
const syncFn = createSyncFn(${JSON.stringify(lateWorker)})
process.stdout.write(String(syncFn()))`,
  )

  // the child is what makes the no-timeout case safe to assert: a regression hangs it, and this
  // kills it and fails the test instead of the whole run
  const output = execFileSync(process.execPath, [probe], {
    encoding: 'utf8',
    // an empty value is what `DEFAULT_TIMEOUT` reads as no budget at all
    env: { ...process.env, SYNCKIT_TIMEOUT: '' },
    timeout: 10_000,
  })

  expect(output).toBe('late 0')
})

test('a notification that never brings a message fails at the deadline', () => {
  // the spin bound is reached long before this deadline — each batch of empty reads ends in one
  // slice sleep — but the pending notification keeps `Atomics.wait` from timing out, so the deadline
  // has to be taken in the loop itself. The handler never settles, so nothing is ever posted: the
  // worker stays registered and silent rather than exiting as a load failure
  const silentWorker = writeWorker(
    'silent-message.cjs',
    `const { workerData } = require('node:worker_threads')
const { runAsWorker } = require(${JSON.stringify(workerLibPath)})
const { NOTIFY_INDEX } = require(${JSON.stringify(path.resolve(_dirname, '../shared.cjs'))})
runAsWorker(() => new Promise(() => {}))
Atomics.add(workerData.sharedBufferView, NOTIFY_INDEX, 1)
Atomics.notify(workerData.sharedBufferView, NOTIFY_INDEX)`,
  )
  // the budget has to outlast the spin, which instrumentation stretches well past the ~22ms it takes
  // uninstrumented, or the deadline would fire before the bound is reached
  const syncFn = createSyncFn<() => unknown>(silentWorker, { timeout: 1500 })

  const started = Date.now()
  expect(failureOf(syncFn)).toContain('timed-out')
  expect(Date.now() - started).toBeLessThan(TIMEOUT)
})

test('a call that times out at the spin bound aborts the worker', async () => {
  // the deadline is taken inside the loop while a pending notification keeps `Atomics.wait` from
  // timing out, so the abort that the wait's own timeout sends has to be sent from there too:
  // without it the worker keeps working and posts a late answer nobody reads, which bumps the
  // counter for the next call. The budget has to outlast the spin, which instrumentation stretches
  const marker = path.join(tmpdir, 'aborted.json')
  const abortWorker = writeWorker(
    'abort-at-bound.cjs',
    `const { workerData } = require('node:worker_threads')
const fs = require('node:fs')
const { runAsWorker } = require(${JSON.stringify(workerLibPath)})
const { NOTIFY_INDEX } = require(${JSON.stringify(path.resolve(_dirname, '../shared.cjs'))})
const view = workerData.sharedBufferView
// announce, so the caller's wait returns at once and its spin reaches the bound before the deadline
Atomics.add(view, NOTIFY_INDEX, 1)
Atomics.notify(view, NOTIFY_INDEX)
runAsWorker(
  () =>
    new Promise(resolve => {
      const finish = aborted => {
        // 200ms after the answer would have been posted: the counter shows whether it was
        setTimeout(() => {
          fs.writeFileSync(
            ${JSON.stringify(marker)},
            JSON.stringify({ aborted, counter: Atomics.load(view, NOTIFY_INDEX) }),
          )
          resolve('late')
        }, 200)
      }
      const timer = setTimeout(() => finish(false), 3000)
      workerData.workerPort.on('message', message => {
        if (message && message.cmd === 'abort') {
          clearTimeout(timer)
          finish(true)
        }
      })
    }),
)`,
  )
  const syncFn = createSyncFn<() => unknown>(abortWorker, { timeout: 1500 })

  expect(failureOf(syncFn)).toContain('timed-out')

  const deadline = Date.now() + TIMEOUT
  while (!fs.existsSync(marker) && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 50))
  }

  expect(fs.existsSync(marker)).toBe(true)
  // one, the announcement: no late answer was posted
  expect(JSON.parse(fs.readFileSync(marker, 'utf8'))).toEqual({
    aborted: true,
    counter: 1,
  })
})

test('a worker still gets the guard when its parent clears NODE_OPTIONS', () => {
  // the check trusts the variable the module was loaded with, so the child has to start with it and
  // remove it inside: a value set at runtime in this process is not what a spawned worker inherits
  // either way. The guard has to be preloaded through `execArgv` then, or the worker module's own
  // failure is reported by nothing and the call waits for an answer that never comes
  const loadFailingWorker = writeWorker(
    'cleared-node-options.cjs',
    `throw new Error('cleared node options boom')`,
  )
  const probe = writeWorker(
    'cleared-probe.cjs',
    `const { createSyncFn } = require(${JSON.stringify(workerLibPath)})
delete process.env.NODE_OPTIONS
try {
  createSyncFn(${JSON.stringify(loadFailingWorker)}, 2000)()
  process.stdout.write('no failure')
} catch (error) {
  process.stdout.write(String(error && error.message))
}`,
  )

  const output = execFileSync(process.execPath, [probe], {
    encoding: 'utf8',
    env: {
      ...process.env,
      NODE_OPTIONS: `${REQUIRE_ABBR_FLAG} ${JSON.stringify(workerPreloadPath)}`,
    },
  })

  expect(output).toContain('cleared node options boom')
})

// The fallback these drive is taken where the runtime rejects the worker's environment. `--title`
// is rejected on every Node measured — 18.18 with `--openssl-legacy-provider` is the original case —
// while a runtime that accepted it would simply take the primary path, so each test asserts what holds
// on the path it actually took rather than pretending it can force the other
const FALLBACK_NODE_OPTIONS = '--title=synckit-fallback-test'
const FALLBACK_TEST_TIMEOUT = 60_000
const silentFallbackWorker = `const { runAsWorker } = require(${JSON.stringify(workerLibPath)})
runAsWorker(() => new Promise(() => {}))`

test('a fallback worker warns about the relaxed guard ordering, once', () => {
  const previousNodeOptions = process.env.NODE_OPTIONS
  const warnSpy = jest.spyOn(process, 'emitWarning')
  try {
    process.env.NODE_OPTIONS = FALLBACK_NODE_OPTIONS
    const fallbackSyncFn = syncFnFor<(value: number) => number>(
      'fallback-warning.cjs',
      cjsWorker(identityWorker),
    )

    expect(fallbackSyncFn(1)).toBe(1)
    expect(warnSpy).toHaveBeenCalledTimes(1)

    const [message, options] = warnSpy.mock.calls[0]
    expect(message).toBe(
      'synckit: this Node rejected the worker environment, so the failure guard loads after ' +
        'inherited `NODE_OPTIONS` preloads; a failure in one of those cannot be reported. Set ' +
        '`SYNCKIT_TIMEOUT` to bound the wait.',
    )
    expect(options).toEqual({ code: 'SYNCKIT_GUARD_ORDERING' })

    // the primary path adds no second warning
    delete process.env.NODE_OPTIONS
    const primarySyncFn = syncFnFor<(value: number) => number>(
      'primary-warning.cjs',
      cjsWorker(identityWorker),
    )

    expect(primarySyncFn(2)).toBe(2)
    expect(warnSpy).toHaveBeenCalledTimes(1)
  } finally {
    warnSpy.mockRestore()
    if (previousNodeOptions == null) {
      delete process.env.NODE_OPTIONS
    } else {
      process.env.NODE_OPTIONS = previousNodeOptions
    }
  }
})

test('nothing caps a wait on the fallback path', () => {
  // the only bound is the caller's, so with none configured the wait is handed `undefined`, which is
  // what `Atomics.wait` reads as no timeout. Asserting the argument the spy saw proves there is no
  // built-in cap without waiting one out
  const previousNodeOptions = process.env.NODE_OPTIONS
  const waitSpy = jest.spyOn(Atomics, 'wait').mockReturnValue('timed-out')
  try {
    process.env.NODE_OPTIONS = FALLBACK_NODE_OPTIONS
    const syncFn = createSyncFn<() => unknown>(
      writeWorker('fallback-no-cap.cjs', cjsWorker(identityWorker)),
    )

    // index from before the call: another spec may have spied on the same global first
    const waitCallsBefore = waitSpy.mock.calls.length
    expect(() => syncFn()).toThrow('timed-out')
    // the configured default, not a built-in cap: the value a run sets through `SYNCKIT_TIMEOUT`,
    // and `undefined` when it sets none
    expect(waitSpy.mock.calls[waitCallsBefore][3]).toBe(DEFAULT_TIMEOUT)
  } finally {
    waitSpy.mockRestore()
    if (previousNodeOptions == null) {
      delete process.env.NODE_OPTIONS
    } else {
      process.env.NODE_OPTIONS = previousNodeOptions
    }
  }
})

test('a healthy call on the fallback path still succeeds', () => {
  // no timeout is configured here on purpose: the fallback's own deadline is what applies, and the
  // child keeps a regression survivable, since an unbounded wait would take the jest run with it
  const healthyWorker = writeWorker(
    'fallback-healthy.cjs',
    cjsWorker(identityWorker),
  )
  const probe = writeWorker(
    'fallback-healthy-probe.cjs',
    `process.env.NODE_OPTIONS = ${JSON.stringify(FALLBACK_NODE_OPTIONS)}
const { createSyncFn } = require(${JSON.stringify(workerLibPath)})
try {
  process.stdout.write(String(createSyncFn(${JSON.stringify(healthyWorker)})(7)))
} catch (error) {
  process.stdout.write('threw: ' + String(error && error.message))
}`,
  )

  const output = execFileSync(process.execPath, [probe], {
    encoding: 'utf8',
    env: { ...process.env, SYNCKIT_TIMEOUT: '' },
    timeout: 20_000,
  })

  expect(output).toBe('7')
})

test(
  'a caller timeout still wins on the fallback path',
  () => {
    const silentWorker = writeWorker(
      'fallback-caller-timeout-worker.cjs',
      silentFallbackWorker,
    )
    const probe = writeWorker(
      'fallback-caller-timeout-probe.cjs',
      `process.env.NODE_OPTIONS = ${JSON.stringify(FALLBACK_NODE_OPTIONS)}
process.env.SYNCKIT_TIMEOUT = '1500'
const { createSyncFn } = require(${JSON.stringify(workerLibPath)})
try {
  createSyncFn(${JSON.stringify(silentWorker)})()
  process.stdout.write('no failure')
} catch (error) {
  process.stdout.write(String(error && error.message))
}`,
    )

    const output = execFileSync(process.execPath, [probe], {
      encoding: 'utf8',
      env: { ...process.env, SYNCKIT_TIMEOUT: '' },
      timeout: 20_000,
    })

    expect(output).toContain('timed-out')
  },
  FALLBACK_TEST_TIMEOUT,
)

test('a guard pair in execArgv does not hide the TypeScript runner', () => {
  // the pair is not a register the caller asked for, so it must not reach the runner selection:
  // otherwise the runner is skipped and a TypeScript worker is loaded as plain JavaScript. The
  // worker counts the runner's own arguments, which is observable on every Node, not only the ones
  // that cannot strip types at all
  const runnerWorker = writeWorker(
    'guard-with-runner.ts',
    `const { runAsWorker } = require(${JSON.stringify(workerLibPath)})
runAsWorker(
  () =>
    process.execArgv.filter(argument =>
      String(argument).includes('esbuild-register'),
    ).length,
)`,
  )
  const syncFn = createSyncFn<() => number>(runnerWorker, {
    // what forwarding `process.execArgv` from a worker this code created looks like
    execArgv: [REQUIRE_ABBR_FLAG, workerPreloadPath],
    timeout: TIMEOUT,
    tsRunner: TsRunner.EsbuildRegister,
  })

  expect(syncFn()).toBe(1)
})

test('a guard already in execArgv is not doubled when nesting', () => {
  // the pair this code adds at each level turns up in that worker's own `process.execArgv`, so a
  // nested creation that forwards them with `execArgv: process.execArgv` would otherwise grow one
  // pair per level. The inner worker counts the pairs it was started with
  const inner = writeWorker(
    'exec-argv-inner.cjs',
    `const { runAsWorker } = require(${JSON.stringify(workerLibPath)})
runAsWorker(
  () =>
    process.execArgv.filter(
      (argument, index) =>
        String(argument).includes('register.cjs') &&
        process.execArgv[index - 1] === '-r',
    ).length,
)`,
  )
  const outer = writeWorker(
    'exec-argv-outer.cjs',
    `const { createSyncFn, runAsWorker } = require(${JSON.stringify(workerLibPath)})
const inner = createSyncFn(${JSON.stringify(inner)}, {
  timeout: 5000,
  execArgv: process.execArgv,
})
runAsWorker(() => inner())`,
  )
  const syncFn = createSyncFn<() => number>(outer, {
    timeout: TIMEOUT,
    // what a process whose own arguments already carry the guard has to forward
    execArgv: [REQUIRE_ABBR_FLAG, workerPreloadPath],
  })

  expect(syncFn()).toBe(1)
})

// Two probes for the paired report Node raises under `--unhandled-rejections=strict`: one drives the
// real flow, the other the same pair through the emitter, since in a worker the guard's own
// `unhandledRejection` listener keeps the runtime from promoting it (measured: the worker sees only
// `unhandledRejection`, where a main-thread script sees both with the same reason object)
const strictWorkerTemplate = (
  raise: string,
) => `const { workerData } = require('node:worker_threads')
const { runAsWorker } = require(${JSON.stringify(workerLibPath)})
const { NOTIFY_INDEX } = require(${JSON.stringify(path.resolve(_dirname, '../shared.cjs'))})
// a surviving handler keeps the guard's report non-fatal, so the failure it reports is the only one
process.on('uncaughtException', () => {})
runAsWorker(value => {
  if (value === 'counter') {
    return Atomics.load(workerData.sharedBufferView, NOTIFY_INDEX)
  }
  if (value === 1) {
    ${raise}
    // stay in flight, so the report lands while call 1 waits
    return new Promise(resolve => setTimeout(() => resolve(1), 500))
  }
  return value
})`

const strictProbe = (
  worker: string,
) => `const { createSyncFn } = require(${JSON.stringify(workerLibPath)})
const syncFn = createSyncFn(${JSON.stringify(worker)}, 5000)
const out = []
try {
  syncFn(1)
  out.push('call1 ok')
} catch {
  out.push('call1 threw')
}
try {
  out.push('call2 ' + syncFn(2))
} catch (error) {
  out.push('call2 threw: ' + error.message)
}
try {
  out.push('counter ' + syncFn('counter'))
} catch (error) {
  out.push('counter threw: ' + error.message)
}
process.stdout.write(out.join('; '))`

test('a strict-mode rejection leaves the next call alone', () => {
  // the real flow: a rejection raised while call 1 is in flight, with a surviving handler keeping the
  // report non-fatal. Nothing may be left over for call 2 to be handed
  const worker = writeWorker(
    'strict-rejection.cjs',
    strictWorkerTemplate("void Promise.reject(new Error('paired boom'))"),
  )
  const probe = writeWorker('strict-rejection-probe.cjs', strictProbe(worker))

  const output = execFileSync(
    process.execPath,
    ['--unhandled-rejections=strict', probe],
    {
      encoding: 'utf8',
      env: { ...process.env, SYNCKIT_TIMEOUT: '' },
      timeout: 20_000,
    },
  )

  expect(output).toBe('call1 threw; call2 2; counter 0')
})

test('the paired strict-mode report is not delivered twice', () => {
  // one failure, both events, the same reason object — the pair Node raises in strict mode. It has to
  // produce one report: otherwise the call after the one that consumes it is handed it again
  const worker = writeWorker(
    'paired-report.cjs',
    strictWorkerTemplate(
      "process.emit('uncaughtException', reason)\n    process.emit('unhandledRejection', reason)",
    ),
  )
  const probe = writeWorker('paired-report-probe.cjs', strictProbe(worker))

  const output = execFileSync(process.execPath, [probe], {
    encoding: 'utf8',
    env: { ...process.env, SYNCKIT_TIMEOUT: '' },
    timeout: 20_000,
  })

  expect(output).toBe('call1 threw; call2 2; counter 0')
})

test('a guard already in the inherited NODE_OPTIONS is not prepended twice', async () => {
  // the check reads the array parsed when the module loads, so the variable has to be in place before
  // that: this asserts the load-time case, not a re-read of the variable at call time
  const previousNodeOptions = process.env.NODE_OPTIONS
  process.env.NODE_OPTIONS = `${REQUIRE_ABBR_FLAG} ${JSON.stringify(workerPreloadPath)}`
  jest.resetModules()
  try {
    const { createSyncFn: importedCreateSyncFn } = await import('synckit')
    const syncFn = importedCreateSyncFn<() => number>(
      writeWorker(
        'inherited-guard.cjs',
        `const { runAsWorker } = require(${JSON.stringify(workerLibPath)})
runAsWorker(() => (process.env.NODE_OPTIONS || '').split('register.cjs').length - 1)`,
      ),
      { timeout: TIMEOUT },
    )

    // never two. The count is of `NODE_OPTIONS`, which is what a second prepend would grow, and it
    // can be zero here: a variable set at runtime is not what a spawned worker inherits in this
    // environment (measured), unlike one the process was started with. The guard still loads — this
    // path also carries it in `execArgv`, which the nesting test below covers
    expect(syncFn()).toBeLessThanOrEqual(1)
  } finally {
    if (previousNodeOptions == null) {
      delete process.env.NODE_OPTIONS
    } else {
      process.env.NODE_OPTIONS = previousNodeOptions
    }
    jest.resetModules()
  }
})

test('another preload first in NODE_OPTIONS does not hide the guard', async () => {
  // only the prepend's own shape counts, so a leading `-r` of someone else's has to be looked past.
  // The other preload has to exist, since Node resolves it before the guard
  const otherPreload = writeWorker('other-preload.cjs', '')
  const previousNodeOptions = process.env.NODE_OPTIONS
  process.env.NODE_OPTIONS = `${REQUIRE_ABBR_FLAG} ${JSON.stringify(otherPreload)}`
  jest.resetModules()
  try {
    const { createSyncFn: importedCreateSyncFn } = await import('synckit')
    const syncFn = importedCreateSyncFn<() => unknown>(
      writeWorker(
        'other-preload-worker.cjs',
        `throw new Error('other preload boom')`,
      ),
      { timeout: TIMEOUT },
    )

    expect(failureOf(syncFn)).toContain('other preload boom')
  } finally {
    if (previousNodeOptions == null) {
      delete process.env.NODE_OPTIONS
    } else {
      process.env.NODE_OPTIONS = previousNodeOptions
    }
    jest.resetModules()
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
