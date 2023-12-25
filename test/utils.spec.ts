import fs from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { _dirname } from './helpers'

import {
  DEFAULT_GLOBAL_SHIMS_PRESET,
  _generateGlobals,
  generateGlobals,
  isFile,
} from 'synckit'

describe('utils', () => {
  test('isFile', () => {
    expect(isFile(_dirname)).toBe(false)
    expect(isFile('non-existed')).toBe(false)
    expect(isFile(fileURLToPath(import.meta.url))).toBe(true)
  })

  test('generateGlobals', () => {
    const _importGlobals = _generateGlobals(
      DEFAULT_GLOBAL_SHIMS_PRESET,
      'import',
    )
    expect(_importGlobals).toMatchSnapshot()

    const _requireGlobals = _generateGlobals(
      DEFAULT_GLOBAL_SHIMS_PRESET,
      'require',
    )
    expect(_requireGlobals).toMatchSnapshot()

    const tempDir = String(pathToFileURL(fs.realpathSync(tmpdir())))
    const importGlobals = generateGlobals(
      'fake.js',
      DEFAULT_GLOBAL_SHIMS_PRESET,
    )
    expect(importGlobals).not.toBe(_importGlobals)
    expect(importGlobals).toMatch(tempDir)
    expect(generateGlobals('fake.js', DEFAULT_GLOBAL_SHIMS_PRESET)).toBe(
      importGlobals,
    )

    const requireGlobals = generateGlobals(
      'fake.js',
      DEFAULT_GLOBAL_SHIMS_PRESET,
      'require',
    )
    expect(requireGlobals).toBe(_requireGlobals)
    expect(requireGlobals).not.toBe(importGlobals)
    expect(
      generateGlobals('fake.js', DEFAULT_GLOBAL_SHIMS_PRESET, 'require'),
    ).toBe(requireGlobals)

    expect(
      _generateGlobals(
        [
          {
            ...DEFAULT_GLOBAL_SHIMS_PRESET[0],
            conditional: false,
          },
          ...DEFAULT_GLOBAL_SHIMS_PRESET.slice(1),
        ],
        'import',
      ),
    ).toMatchSnapshot()

    expect(
      _generateGlobals(
        [
          {
            ...DEFAULT_GLOBAL_SHIMS_PRESET[0],
            conditional: false,
          },
          ...DEFAULT_GLOBAL_SHIMS_PRESET.slice(1),
        ],
        'require',
      ),
    ).toMatchSnapshot()
  })
})
