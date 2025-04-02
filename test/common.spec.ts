import { jest } from '@jest/globals'

import { compareVersion } from 'synckit'

describe('common', () => {
  describe('hasFlag', () => {
    let hasFlag: (flag: string) => boolean

    beforeEach(() => {
      jest.resetModules()
      delete process.env.NODE_OPTIONS
      process.argv = []
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

    it('should return true if the flag is present in process.argv', async () => {
      process.argv.push('--experimental-modules')
      ;({ hasFlag } = await import('synckit'))
      expect(hasFlag('--experimental-modules')).toBe(true)
    })

    it('should return false if the flag is not present in process.argv', async () => {
      process.argv.push('--experimental-modules')
      ;({ hasFlag } = await import('synckit'))
      expect(hasFlag('--no-deprecation')).toBe(false)
    })

    it('should return false if NODE_OPTIONS and process.argv are not set', async () => {
      ;({ hasFlag } = await import('synckit'))
      expect(hasFlag('--experimental-modules')).toBe(false)
    })

    it('should return false if NODE_OPTIONS and process.argv are empty', async () => {
      ;({ hasFlag } = await import('synckit'))
      expect(hasFlag('--experimental-modules')).toBe(false)
    })

    it('should return false if NODE_OPTIONS and process.argv are empty strings', async () => {
      process.argv = ['']
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
