/* eslint-disable @typescript-eslint/unbound-method, jest/no-standalone-expect */

import { jest } from '@jest/globals'

import {
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

      expect(stdio.length).toBe(1)
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

      expect(stdio.length).toBe(1)
      expect(stdio[0]).toEqual({
        type: 'stderr',
        chunk: Buffer.from('test error'),
        encoding: 'utf8',
      })
      expect(callback).toHaveBeenCalled()
    })
  })
})
