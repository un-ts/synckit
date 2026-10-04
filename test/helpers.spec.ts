/* eslint-disable @typescript-eslint/unbound-method, jest/no-standalone-expect */

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { MessagePort } from 'node:worker_threads'

import { jest } from '@jest/globals'

import { installWorkerLoadGuard, markWorkerRegistered } from '../register.cjs'
import { createSharedBufferView, getFlag } from '../shared.cjs'

import {
  _dirname,
  testIf,
  workerCjsPath,
  workerCjsTsPath,
  workerMjsAsMtsPath,
  workerMtsPath,
  workerTsPath,
} from './helpers.ts'

import {
  DEFAULT_TYPES_NODE_VERSION,
  IMPORT_FLAG,
  LOADER_FLAG,
  REQUIRE_ABBR_FLAG,
  REQUIRE_FLAG,
  TRANSFORM_TYPES_FLAG,
  TRANSFORM_TYPES_NODE_VERSION,
  TsRunner,
  compareNodeVersion,
  dataUrl,
  extractProperties,
  generateGlobals,
  hasImportFlag,
  hasLoaderFlag,
  hasRequireFlag,
  md5Hash,
  overrideStdio,
  setupTsRunner,
  type StdioChunk,
} from 'synckit'

describe('helpers', () => {
  describe('flag detection utilities', () => {
    test('hasRequireFlag', () => {
      // Should return true when --require flag is present
      expect(hasRequireFlag([REQUIRE_FLAG, 'some-module'])).toBe(true)

      // Should return true when -r shorthand flag is present
      expect(hasRequireFlag([REQUIRE_ABBR_FLAG, 'some-module'])).toBe(true)

      // Should return true when flag is in the middle of array
      expect(
        hasRequireFlag(['--other-flag', REQUIRE_FLAG, 'some-module']),
      ).toBe(true)

      // Should return false when flag is not present
      expect(hasRequireFlag(['--other-flag'])).toBe(false)

      // Should return false for empty array
      expect(hasRequireFlag([])).toBe(false)
    })

    test('hasImportFlag', () => {
      // Should return true when --import flag is present
      expect(hasImportFlag([IMPORT_FLAG, 'some-module'])).toBe(true)

      // Should return true when flag is in the middle of array
      expect(hasImportFlag(['--other-flag', IMPORT_FLAG, 'some-module'])).toBe(
        true,
      )

      // Should return false when flag is not present
      expect(hasImportFlag(['--other-flag'])).toBe(false)

      // Should return false for empty array
      expect(hasImportFlag([])).toBe(false)
    })

    test('hasLoaderFlag', () => {
      // Should return true when --loader flag is present
      expect(hasLoaderFlag([LOADER_FLAG, 'some-loader'])).toBe(true)

      // Should return true when flag is in the middle of array
      expect(hasLoaderFlag(['--other-flag', LOADER_FLAG, 'some-module'])).toBe(
        true,
      )

      // Should return false when flag is not present
      expect(hasLoaderFlag(['--other-flag'])).toBe(false)

      // Should return false for empty array
      expect(hasLoaderFlag([])).toBe(false)
    })

    /** Runs `fn` with the process's runtime flags replaced, restoring them afterwards. */
    const withExecArgv = (execArgv: string[], fn: () => void) => {
      const previous = process.execArgv
      process.execArgv = execArgv
      try {
        fn()
      } finally {
        process.execArgv = previous
      }
    }

    test('getFlag reads a value joined with = or given as the next argument', () => {
      withExecArgv(['--key=value'], () => {
        expect(getFlag('--key')).toBe('value')
      })
      withExecArgv(['--key', 'value'], () => {
        expect(getFlag('--key')).toBe('value')
      })
      withExecArgv(['--other', '--key=value'], () => {
        expect(getFlag('--key')).toBe('value')
      })
      // the first value wins
      withExecArgv(['--key=first', '--key=second'], () => {
        expect(getFlag('--key')).toBe('first')
      })
    })

    test('getFlag tells a flag without a value from an absent flag', () => {
      withExecArgv(['--key'], () => {
        expect(getFlag('--key')).toBe('')
      })
      withExecArgv(['--key='], () => {
        expect(getFlag('--key')).toBe('')
      })
      // a following flag is not this flag's value
      withExecArgv(['--key', '--other'], () => {
        expect(getFlag('--key')).toBe('')
      })
      withExecArgv(['--other'], () => {
        expect(getFlag('--key')).toBeUndefined()
      })
      withExecArgv([], () => {
        expect(getFlag('--key')).toBeUndefined()
      })
    })

    test('getFlag takes any of a set of names', () => {
      const require = new Set(['-r', '--require'])
      withExecArgv(['-r', 'value'], () => {
        expect(getFlag(require)).toBe('value')
      })
      withExecArgv(['--require=value'], () => {
        expect(getFlag(require)).toBe('value')
      })
      withExecArgv(['--other', 'value'], () => {
        expect(getFlag(require)).toBeUndefined()
      })
      // the first name found wins, whatever its form
      withExecArgv(['--require=first', '-r', 'second'], () => {
        expect(getFlag(require)).toBe('first')
      })
    })

    test('getFlag skips the values that are not the accepted one', () => {
      const require = new Set(['-r', '--require'])
      withExecArgv(['--require', 'first', '-r', 'second'], () => {
        expect(getFlag(require)).toBe('first')
        // a value that is not accepted does not end the scan
        expect(getFlag(require, 'second')).toBe('second')
        expect(getFlag(require, 'third')).toBeUndefined()
      })
    })

    test('getFlag does not read a script argument', () => {
      // a flag after the script path reaches `argv`, which Node does not apply
      process.argv.push('--key=value')
      try {
        expect(getFlag('--key')).toBeUndefined()
      } finally {
        process.argv.pop()
      }
    })
  })

  describe('dataUrl', () => {
    test('should encode JavaScript code into a data URL', () => {
      const code = 'console.log("Hello, world!")'
      const url = dataUrl(code)

      expect(url).toBeInstanceOf(URL)
      expect(url.protocol).toBe('data:')
      expect(url.href).toContain('text/javascript')
      expect(decodeURIComponent(url.href.split(',')[1])).toBe(code)
    })

    test('should handle empty code', () => {
      const url = dataUrl('')
      expect(url.href).toContain('text/javascript')
      expect(url.href.split(',')[1]).toBe('')
    })

    test('should properly encode special characters', () => {
      const code = 'const x = "a&b=c"; // special chars: <>?#'
      const url = dataUrl(code)
      expect(decodeURIComponent(url.href.split(',')[1])).toBe(code)
    })
  })

  describe('md5Hash', () => {
    test('should generate correct md5 hash', () => {
      expect(md5Hash('test')).toBe('098f6bcd4621d373cade4e832627b4f6')
      expect(md5Hash('')).toBe('d41d8cd98f00b204e9800998ecf8427e')
      expect(md5Hash('synckit')).toBe('0719a57dc09033554c7ef84bd4311cf6')
    })
  })

  describe('extractProperties', () => {
    test('should create a shallow copy of object properties', () => {
      const original = { a: 1, b: 'string', c: true }
      const copy = extractProperties(original)

      expect(copy).toEqual(original)
      expect(copy).not.toBe(original) // Different object reference
    })

    test('should handle nested objects (shallow copy only)', () => {
      const nested = { x: { y: 2 } }
      const original = { a: 1, nested }
      const copy = extractProperties(original)

      expect(copy.nested).toBe(original.nested) // Same nested object reference
      expect(copy).toEqual(original)
    })

    test('should return undefined for undefined input', () => {
      expect(extractProperties()).toBeUndefined()
    })

    test('should handle Error objects with custom properties', () => {
      const error = new Error('test error')
      Object.assign(error, { code: 'ERR_TEST', warnings: ['warning1'] })

      interface CustomError extends Error {
        code: string
        warnings: string[]
      }

      const copy = extractProperties(error) as CustomError
      expect(copy.message).toBeUndefined() // `message` is non-enumerable
      expect(copy.code).toBe('ERR_TEST')
      expect(copy.warnings).toEqual(['warning1'])
    })
  })

  describe('setupTsRunner', () => {
    afterEach(() => {
      jest.restoreAllMocks()
    })

    test('should identify JS file correctly', () => {
      const result = setupTsRunner(workerCjsPath)

      expect(result.ext).toBe('.cjs')
      expect(result.isTs).toBe(false)
      expect(result.jsUseEsm).toBe(false)
      expect(result.tsUseEsm).toBe(false)
      expect(result.workerPath).toBe(workerCjsPath)
    })

    test('should identify TS file correctly', () => {
      const result = setupTsRunner(workerCjsTsPath, {
        tsRunner: TsRunner.TsNode,
      })

      expect(result.ext).toBe('.ts')
      expect(result.isTs).toBe(true)
      expect(result.tsRunner).toBe(TsRunner.TsNode)
      expect(result.execArgv).toContain(REQUIRE_ABBR_FLAG)
      expect(result.execArgv).toContain('ts-node/register')
      expect(result.workerPath).toBe(workerCjsTsPath)
    })

    test('should handle ESM TS files with ts-node runner', () => {
      const result = setupTsRunner(workerTsPath, {
        tsRunner: TsRunner.TsNode,
      })

      expect(result.tsUseEsm).toBe(true)
      expect(result.execArgv).toContain(LOADER_FLAG)
      expect(result.execArgv).toContain('ts-node/esm')
    })

    test('should handle .mts files properly', () => {
      const result = setupTsRunner(workerMjsAsMtsPath, {
        tsRunner: TsRunner.TsNode,
      })

      expect(result.ext).toBe('.mts')
      expect(result.isTs).toBe(true)
      expect(result.tsUseEsm).toBe(true)
      expect(result.execArgv).toContain(LOADER_FLAG)
      expect(result.execArgv).toContain('ts-node/esm')
      expect(result.workerPath).toBe(workerMtsPath)
    })

    // can not be mocked correctly for now
    testIf(compareNodeVersion(TRANSFORM_TYPES_NODE_VERSION) >= 0)(
      'should add `TRANSFORM_TYPES_FLAG` for Node TS runner',
      () => {
        const { execArgv } = setupTsRunner(workerTsPath, {
          tsRunner: TsRunner.Node,
        })

        if (compareNodeVersion(DEFAULT_TYPES_NODE_VERSION) >= 0) {
          expect(execArgv).not.toContain(TRANSFORM_TYPES_FLAG)
        } else {
          expect(execArgv).toContain(TRANSFORM_TYPES_FLAG)
        }
      },
    )

    test('should handle OXC runner', () => {
      const { execArgv } = setupTsRunner(workerTsPath, {
        tsRunner: TsRunner.OXC,
      })

      expect(execArgv).toContain(IMPORT_FLAG)
      expect(execArgv).toContain('@oxc-node/core/register')
    })

    test('should throw error for unknown runner', () => {
      expect(() => {
        setupTsRunner(workerTsPath, {
          // @ts-expect-error -- intended
          tsRunner: 'unknown-runner',
        })
      }).toThrow('Unknown ts runner')
    })
  })

  describe('overrideStdio', () => {
    // Save original _writev methods
    const originalStdoutWritev = process.stdout._writev
    const originalStderrWritev = process.stderr._writev

    afterEach(() => {
      // Restore original methods after each test
      process.stdout._writev = originalStdoutWritev
      process.stderr._writev = originalStderrWritev
    })

    test('should override stdout._writev', () => {
      const stdio: StdioChunk[] = []
      overrideStdio(stdio)

      // Test that _writev was replaced with a new function
      expect(process.stdout._writev).not.toBe(originalStdoutWritev)
      expect(process.stderr._writev).not.toBe(originalStderrWritev)

      // Test the functionality by calling the new _writev directly
      const callback = jest.fn()
      const chunks = [{ chunk: Buffer.from('test'), encoding: 'utf8' as const }]

      process.stdout._writev!(chunks, callback)

      expect(stdio).toHaveLength(1)
      expect(stdio[0].type).toBe('stdout')
      expect(stdio[0].chunk).toEqual(Buffer.from('test'))
      expect(callback).toHaveBeenCalled()
    })

    test('should override stderr._writev', () => {
      const stdio: StdioChunk[] = []
      overrideStdio(stdio)

      const chunks = [
        { chunk: Buffer.from('test error'), encoding: 'utf8' as const },
      ]
      const callback = jest.fn()

      process.stderr._writev!(chunks, callback)

      expect(stdio).toHaveLength(1)
      expect(stdio[0]).toEqual({
        type: 'stderr',
        chunk: Buffer.from('test error'),
        encoding: 'utf8',
      })
      expect(callback).toHaveBeenCalled()
    })
  })

  describe('worker load guard', () => {
    const createPort = (failCount = 0) => {
      const messages: unknown[] = []
      let calls = 0
      const port = {
        postMessage: (message: unknown) => {
          calls += 1
          if (calls <= failCount) {
            throw new Error('not cloneable')
          }
          messages.push(message)
        },
      } as unknown as MessagePort
      return { messages, port }
    }

    const install = (port: MessagePort, view: Int32Array) => {
      installWorkerLoadGuard({ workerPort: port, sharedBufferView: view })
      return process.listeners('uncaughtException').pop() as unknown as (
        error: unknown,
      ) => void
    }

    const listeners = () => process.listenerCount('uncaughtException')

    // the guard registers listeners on the process; snapshot them so a test that leaves the guard
    // armed (a non-fatal report re-arms it) cannot leak into the next test
    let beforeListeners: {
      uncaughtException: unknown[]
      unhandledRejection: unknown[]
    }

    /** Drop any listener the guard added since the snapshot, such as a re-armed one. */
    const removeAddedListeners = () => {
      for (const listener of process.listeners('uncaughtException')) {
        if (!beforeListeners.uncaughtException.includes(listener)) {
          process.off('uncaughtException', listener)
        }
      }
      for (const listener of process.listeners('unhandledRejection')) {
        if (!beforeListeners.unhandledRejection.includes(listener)) {
          process.off('unhandledRejection', listener)
        }
      }
    }

    beforeEach(() => {
      beforeListeners = {
        uncaughtException: process.listeners('uncaughtException'),
        unhandledRejection: process.listeners('unhandledRejection'),
      }
      // a fatal report stops the worker; jest-runner installs its own `process.exit` when the file
      // runs, so spy on it here, after that replacement is in place
      jest
        .spyOn(process, 'exit')
        .mockImplementation(((code?: number) => code) as never)
    })

    afterEach(() => {
      removeAddedListeners()
      jest.restoreAllMocks()
    })

    test('reports the error with its properties and wakes the main thread', () => {
      const { messages, port } = createPort()
      const view = createSharedBufferView()
      const before = listeners()

      install(port, view)(Object.assign(new Error('boom'), { code: 'E_BOOM' }))

      expect(messages).toHaveLength(1)
      const [message] = messages as [
        { error: Error; workerFailure: boolean; properties: unknown },
      ]
      expect(message.workerFailure).toBe(true)
      expect(message.error.message).toBe('boom')
      expect(message.properties).toEqual({ code: 'E_BOOM' })
      expect(Atomics.load(view, 0)).toBe(1)
      // invoking the guard disarmed it
      expect(listeners()).toBe(before)
    })

    test('reports a falsy failure as it is', () => {
      const { messages, port } = createPort()
      const view = createSharedBufferView()

      install(port, view)(null)

      const [message] = messages as [{ error: unknown }]
      expect(message.error).toBeNull()
      expect(Atomics.load(view, 0)).toBe(1)
    })

    test('wakes the main thread even when reading the properties throws', () => {
      const { messages, port } = createPort()
      const view = createSharedBufferView()
      const error = new Error('boom')
      Object.defineProperty(error, 'trap', {
        enumerable: true,
        get() {
          throw new Error('nope')
        },
      })

      install(port, view)(error)

      // the property copy threw, so the bare error was posted instead, and the caller is woken
      expect(messages).toHaveLength(1)
      const [message] = messages as [{ error: Error }]
      expect(message.error).toBe(error)
      expect(Atomics.load(view, 0)).toBe(1)
    })

    test('wakes the main thread when the error cannot be serialized', () => {
      const { messages, port } = createPort(1)
      const view = createSharedBufferView()

      install(port, view)(new Error('boom'))

      expect(messages).toHaveLength(1)
      const [message] = messages as [{ error: Error }]
      // the first post failed, so the bare original error is sent instead of a synthetic one
      expect(message.error.message).toBe('boom')
      expect(Atomics.load(view, 0)).toBe(1)
    })

    test('names the reason in the synthesized error', () => {
      // the port refuses the full error and the bare one, so the synthetic error is what is left
      const fatal = createPort(2)
      install(fatal.port, createSharedBufferView())(new Error('boom'))

      const [fatalMessage] = fatal.messages as [{ error: Error }]
      expect(fatalMessage.error.message).toBe(
        'Worker module failed to load: boom',
      )

      const handler = jest.fn()
      process.on('uncaughtException', handler)
      try {
        const recovered = createPort(2)
        const view = createSharedBufferView()
        const guard = install(recovered.port, view)
        markWorkerRegistered(view)
        guard(new Error('boom'))

        const [recoveredMessage] = recovered.messages as [{ error: Error }]
        expect(recoveredMessage.error.message).toBe('Worker failed: boom')
      } finally {
        process.off('uncaughtException', handler)
      }
    })

    test('falls back to `instanceof` when `Error.isError` is unavailable', async () => {
      const descriptor = Object.getOwnPropertyDescriptor(Error, 'isError')
      Reflect.deleteProperty(Error, 'isError')
      jest.resetModules()
      try {
        const { installWorkerLoadGuard: installWithoutIsError } =
          await import('../register.cjs')
        // the registry really was reset, so the module saw `Error.isError` absent
        expect(installWithoutIsError).not.toBe(installWorkerLoadGuard)

        const { messages, port } = createPort(2)
        const view = createSharedBufferView()
        installWithoutIsError({ workerPort: port, sharedBufferView: view })

        const guard = process
          .listeners('uncaughtException')
          .pop() as unknown as (error: unknown) => void
        guard(new Error('boom'))

        const [message] = messages as [{ error: Error }]
        expect(message.error.message).toBe('Worker module failed to load: boom')
      } finally {
        if (descriptor) {
          Object.defineProperty(Error, 'isError', descriptor)
        }
        jest.resetModules()
      }
    })

    test('judges recovery per event, not across events', () => {
      const handler = jest.fn()
      process.on('unhandledRejection', handler)
      try {
        const { messages, port } = createPort()
        const view = createSharedBufferView()
        const guard = install(port, view)
        markWorkerRegistered(view)

        guard(new Error('uncaught boom'))

        // a listener for the other event cannot handle an uncaught exception
        const [message] = messages as [{ fatal: boolean }]
        expect(message.fatal).toBe(true)
        expect(jest.mocked(process.exit)).toHaveBeenCalledWith(1)
      } finally {
        process.off('unhandledRejection', handler)
      }
    })

    test('an unhandled rejection is recoverable through an uncaughtException listener', () => {
      const handler = jest.fn()
      process.on('uncaughtException', handler)
      try {
        const { messages, port } = createPort()
        const view = createSharedBufferView()
        installWorkerLoadGuard({ workerPort: port, sharedBufferView: view })
        const rejectionGuard = process
          .listeners('unhandledRejection')
          .pop() as unknown as (reason: unknown) => void
        markWorkerRegistered(view)

        rejectionGuard(new Error('rejection boom'))

        // Node promotes a rejection to the uncaughtException handler under the default mode
        const [message] = messages as [{ fatal: boolean }]
        expect(message.fatal).toBe(false)
        expect(jest.mocked(process.exit)).not.toHaveBeenCalled()
      } finally {
        process.off('uncaughtException', handler)
      }
    })

    test('marks a failure fatal unless the worker is left handled', () => {
      // never registered: nothing can serve a later call
      const first = createPort()
      const firstView = createSharedBufferView()
      install(first.port, firstView)(new Error('before registering'))
      expect((first.messages[0] as { fatal: boolean }).fatal).toBe(true)

      // registered, and another listener is left to handle the event
      const handler = jest.fn()
      process.on('uncaughtException', handler)
      try {
        const second = createPort()
        const secondView = createSharedBufferView()
        const guard = install(second.port, secondView)
        markWorkerRegistered(secondView)
        guard(new Error('after registering'))
        expect((second.messages[0] as { fatal: boolean }).fatal).toBe(false)
      } finally {
        process.off('uncaughtException', handler)
      }

      // registered, but nothing is left to handle it: the worker would have died. The second case
      // re-armed its own guard, so drop that before asking about this view on its own.
      removeAddedListeners()
      const third = createPort()
      const thirdView = createSharedBufferView()
      const guard = install(third.port, thirdView)
      markWorkerRegistered(thirdView)
      guard(new Error('unhandled after registering'))
      expect((third.messages[0] as { fatal: boolean }).fatal).toBe(true)
    })

    test('arms again after a non-fatal report', () => {
      const handler = jest.fn()
      process.on('uncaughtException', handler)
      try {
        const { messages, port } = createPort()
        const view = createSharedBufferView()
        const before = listeners()
        const guard = install(port, view)
        markWorkerRegistered(view)

        guard(new Error('first'))

        // non-fatal, so the guard is armed again for the next failure
        expect((messages[0] as { fatal: boolean }).fatal).toBe(false)
        expect(messages).toHaveLength(1)
        expect(listeners()).toBe(before + 1)

        // the re-armed listener reports the second failure with its own reason
        const second = process
          .listeners('uncaughtException')
          .pop() as unknown as (error: unknown) => void
        second(new Error('second'))

        expect(messages).toHaveLength(2)
        expect((messages[1] as { error: Error }).error.message).toBe('second')
        expect((messages[1] as { fatal: boolean }).fatal).toBe(false)
      } finally {
        process.off('uncaughtException', handler)
      }
    })

    test('follows the runtime rejection mode for a listener-less rejection', () => {
      const probe = path.join(
        os.tmpdir(),
        `synckit-rejection-mode-${process.pid}.cjs`,
      )
      fs.writeFileSync(
        probe,
        `const { installWorkerLoadGuard, markWorkerRegistered } = require(${JSON.stringify(
          path.join(_dirname, '../register.cjs'),
        )})
const { createSharedBufferView } = require(${JSON.stringify(
          path.join(_dirname, '../shared.cjs'),
        )})
const messages = []
const port = { postMessage: message => messages.push(message) }
const view = createSharedBufferView()
installWorkerLoadGuard({ workerPort: port, sharedBufferView: view })
markWorkerRegistered(view)
let exited = false
process.exit = () => {
  exited = true
}
process.listeners('unhandledRejection').pop()(new Error('mode probe'))
process.stdout.write(JSON.stringify({ fatal: messages[0].fatal, exited }))
`,
      )

      const classify = ({
        args,
        nodeOptions,
      }: { args?: string[]; nodeOptions?: string } = {}) =>
        JSON.parse(
          execFileSync(process.execPath, [...(args ?? []), probe], {
            encoding: 'utf8',
            env: { ...process.env, NODE_OPTIONS: nodeOptions ?? '' },
          }),
        ) as { fatal: boolean; exited: boolean }

      try {
        // Node 15+ defaults to `throw`; the flag overrides it either way
        expect(classify()).toEqual({ fatal: true, exited: true })
        expect(classify({ args: ['--unhandled-rejections=throw'] })).toEqual({
          fatal: true,
          exited: true,
        })
        expect(classify({ args: ['--unhandled-rejections=strict'] })).toEqual({
          fatal: true,
          exited: true,
        })
        expect(classify({ args: ['--unhandled-rejections=warn'] })).toEqual({
          fatal: false,
          exited: false,
        })
        expect(classify({ args: ['--unhandled-rejections=none'] })).toEqual({
          fatal: false,
          exited: false,
        })
        // Node also takes the value as the next argument
        expect(classify({ args: ['--unhandled-rejections', 'throw'] })).toEqual(
          { fatal: true, exited: true },
        )
        expect(classify({ args: ['--unhandled-rejections', 'warn'] })).toEqual({
          fatal: false,
          exited: false,
        })
        // `NODE_OPTIONS` carries the mode too, in either form, and a worker inherits it
        expect(
          classify({ nodeOptions: '--unhandled-rejections=warn' }),
        ).toEqual({ fatal: false, exited: false })
        expect(
          classify({ nodeOptions: '--unhandled-rejections warn' }),
        ).toEqual({ fatal: false, exited: false })
        expect(
          classify({ nodeOptions: '--unhandled-rejections=throw' }),
        ).toEqual({ fatal: true, exited: true })
      } finally {
        fs.rmSync(probe, { force: true })
      }
    })

    test('arms once, and stays disarmed after a fatal report', () => {
      const { messages, port } = createPort()
      const view = createSharedBufferView()
      const before = listeners()

      const guard = install(port, view)
      expect(listeners()).toBe(before + 1)

      // arming again is a no-op
      installWorkerLoadGuard({ workerPort: port, sharedBufferView: view })
      expect(listeners()).toBe(before + 1)

      // a fatal report stops the worker, so it is not armed again
      guard(new Error('boom'))
      expect(messages).toHaveLength(1)
      expect(listeners()).toBe(before)
    })

    test('generateGlobals returns nothing without shims', () => {
      expect(generateGlobals(workerCjsPath, [])).toBe('')
    })
  })
})
