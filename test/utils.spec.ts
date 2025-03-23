import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { findUp } from '@pkgr/utils'

import { _dirname } from './helpers.js'

import {
  DEFAULT_GLOBAL_SHIMS_PRESET,
  _generateGlobals,
  encodeImportModule,
  extractProperties,
  generateGlobals,
  isFile,
} from 'synckit'

describe('utils', () => {
  test('isFile', () => {
    expect(isFile(_dirname)).toBe(false)
    expect(isFile('non-existed')).toBe(false)
    expect(isFile(fileURLToPath(import.meta.url))).toBe(true)
  })

  test('encodeImportModule', () => {
    const moduleName = 'module-name'
    const onlyModuleName = encodeImportModule(moduleName)
    expect(onlyModuleName).toMatchSnapshot()
    expect(encodeImportModule({ moduleName })).toBe(onlyModuleName)
    expect(
      encodeImportModule({ moduleName: './module-name' }),
    ).toMatchSnapshot()
    expect(
      encodeImportModule({
        moduleName,
        globalName: 'globalName',
      }),
    ).toMatchSnapshot()
    expect(
      encodeImportModule({
        moduleName,
        globalName: 'globalName',
        named: 'named',
      }),
    ).toMatchSnapshot()
    expect(
      encodeImportModule({
        moduleName,
        globalName: 'globalName',
        named: null,
      }),
    ).toMatchSnapshot()
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

    const tmpdir = String(
      pathToFileURL(path.resolve(findUp(_dirname), '../node_modules/.synckit')),
    )
    const importGlobals = generateGlobals(
      'fake.js',
      DEFAULT_GLOBAL_SHIMS_PRESET,
    )
    expect(importGlobals).not.toBe(_importGlobals)
    expect(importGlobals).toMatch(tmpdir)
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

  test('extractProperties', () => {
    expect(extractProperties()).toBeUndefined()
    expect(extractProperties({})).toEqual({})
    expect(extractProperties(new Error('message'))).toEqual({})
    expect(
      extractProperties(
        Object.assign(new Error('message'), {
          code: 'CODE',
        }),
      ),
    ).toEqual({
      code: 'CODE',
    })
  })
})
