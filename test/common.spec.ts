import { jest } from '@jest/globals'

import { compareVersion } from 'synckit'

describe('common', () => {
  describe('hasFlag', () => {
    let hasFlag: (flag: string) => boolean

    const { execArgv } = process

    beforeEach(() => {
      jest.resetModules()
      delete process.env.NODE_OPTIONS
      process.argv = []
      process.execArgv = execArgv
    })

    it('should return true if the flag is present in NODE_OPTIONS', async () => {
      process.env.NODE_OPTIONS = '--experimental-modules'
      ;({ hasFlag } = await import('synckit'))
      expect(hasFlag('--experimental-modules')).toBe(true)
    })

    it('should return false if the flag is not present in NODE_OPTIONS', async () => {
      process.env.NODE_OPTIONS = '--experimental-modules'
      ;({ hasFlag } = await import('synckit'))
      expect(hasFlag('--no-deprecation')).toBe(false)
    })

    it('should ignore a flag that is only a script argument', async () => {
      // Node applies its own flags from `execArgv` and `NODE_OPTIONS`; one written after the
      // script path is an argument to the script, not a runtime flag
      process.argv.push('--experimental-modules')
      ;({ hasFlag } = await import('synckit'))
      expect(hasFlag('--experimental-modules')).toBe(false)
    })

    it('should return true if the flag is passed to the runtime', async () => {
      // Node puts a command-line flag in `execArgv`, not in `argv`
      process.execArgv = ['--experimental-modules']
      ;({ hasFlag } = await import('synckit'))
      expect(hasFlag('--experimental-modules')).toBe(true)
    })

    it('should return true if the flag carries its value', async () => {
      process.execArgv = ['--experimental-modules=value']
      ;({ hasFlag } = await import('synckit'))
      expect(hasFlag('--experimental-modules')).toBe(true)

      process.execArgv = ['--experimental-modules', 'value']
      expect(hasFlag('--experimental-modules')).toBe(true)
    })

    it('should return false if the flag is not set', async () => {
      ;({ hasFlag } = await import('synckit'))
      expect(hasFlag('--experimental-modules')).toBe(false)
    })

    it('should return false if NODE_OPTIONS and the runtime flags are empty', async () => {
      process.env.NODE_OPTIONS = ''
      process.execArgv = []
      ;({ hasFlag } = await import('synckit'))
      expect(hasFlag('--experimental-modules')).toBe(false)
    })
  })

  describe('compareVersion', () => {
    it('should return 0 for equal versions', () => {
      expect(compareVersion('1.0.0', '1.0.0')).toBe(0)
      expect(compareVersion('1.0.0', '1.0.0-rc1')).toBe(0)
    })

    it('should return 1 for greater version', () => {
      expect(compareVersion('2.0.0', '1.0.0')).toBe(1)
      expect(compareVersion('1.2.0', '1.1.9')).toBe(1)
    })

    it('should return -1 for lesser version', () => {
      expect(compareVersion('1.0.0', '2.0.0')).toBe(-1)
      expect(compareVersion('1.1.9', '1.2.0')).toBe(-1)
    })

    it('should handle different length versions', () => {
      expect(compareVersion('1.2', '1.2.3')).toBe(-1)
      expect(compareVersion('2', '2.0')).toBe(0)
    })
  })
})
