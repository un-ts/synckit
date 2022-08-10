import { fileURLToPath } from 'node:url'

import { _dirname } from './helpers'

import { isFile } from 'synckit'

test('utils', () => {
  expect(isFile(_dirname)).toBe(false)
  expect(isFile('non-existed')).toBe(false)
  expect(isFile(fileURLToPath(import.meta.url))).toBe(true)
})
