import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

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

  test('encodeImportModule escapes what a quoted literal cannot hold', () => {
    // a JavaScript literal cannot span lines, so a module name with a newline or a CR used to
    // generate unparseable code (`Invalid or unexpected token`); one escaping routine covers all
    expect(encodeImportModule('a\nb', 'require')).toBe(
      String.raw`require("a\nb")`,
    )
    expect(encodeImportModule('a\rb', 'require')).toBe(
      String.raw`require("a\rb")`,
    )
    expect(encodeImportModule("a'b", 'require')).toBe(`require("a'b")`)
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

    const importGlobals = generateGlobals(
      'fake.js',
      DEFAULT_GLOBAL_SHIMS_PRESET,
    )
    expect(importGlobals).not.toBe(_importGlobals)
    // each specifier is resolved against the worker's URL here, so nothing is left pointing at a
    // generated file under the package's own `node_modules`
    expect(importGlobals).toContain('node:perf_hooks')
    expect(importGlobals).toMatch(/node_modules[\\/]node-fetch/)
    expect(importGlobals).not.toContain('.synckit')
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

  test('generateGlobals resolves through pnpapi under PnP', () => {
    const versions = process.versions as { pnp?: string }
    const { pnp } = versions
    const isolatedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'synckit-pnp-'))
    const pnpDir = path.join(isolatedDir, 'node_modules', 'pnpapi')

    try {
      fs.mkdirSync(pnpDir, { recursive: true })
      fs.writeFileSync(
        path.join(pnpDir, 'package.json'),
        JSON.stringify({ name: 'pnpapi', version: '1.0.0', main: 'index.js' }),
      )
      // stands in for the PnP runtime, recording how it was asked and answering a path — or `null`
      // for a builtin — the way `resolveRequest` does
      fs.writeFileSync(
        path.join(pnpDir, 'index.js'),
        `const fs = require('node:fs')
const path = require('node:path')

exports.resolveRequest = (request, issuer, options) => {
  fs.appendFileSync(
    path.join(__dirname, 'calls.txt'),
    [request, issuer, [...options.conditions].join(',')].join('\\t') + '\\n',
  )
  return request === 'node:perf_hooks' ? null : path.join(__dirname, 'resolved.js')
}
`,
      )

      const workerPath = path.join(isolatedDir, 'worker.js')
      const shims = [
        { moduleName: 'some-shim', globalName: '__someShim' },
        { moduleName: 'node:perf_hooks', globalName: 'performance' },
      ]
      fs.writeFileSync(workerPath, '')
      versions.pnp = '1.0.0'

      const calls = () =>
        fs
          .readFileSync(path.join(pnpDir, 'calls.txt'), 'utf8')
          .trim()
          .split('\n')
          .map(line => line.split('\t'))

      const conditionsOf = (execArgv: string[]) => {
        generateGlobals(workerPath, shims, 'import', execArgv)
        const recorded = calls()
        return recorded.at(-1)![2].split(',')
      }

      const globals = generateGlobals(workerPath, shims)

      expect(globals).toContain('file://')
      expect(globals).toContain('resolved.js')
      expect(globals).toContain('node:perf_hooks')

      // each specifier is resolved against the worker, with the conditions its own `import` uses
      expect(calls().map(([request, issuer]) => [request, issuer])).toEqual([
        ['some-shim', workerPath],
        ['node:perf_hooks', workerPath],
      ])
      expect(conditionsOf([])).toEqual(
        expect.arrayContaining(['node', 'import', 'node-addons']),
      )
      // `module-sync` follows the Node default unless the worker's argv turns `require(esm)` off
      expect(conditionsOf([]).includes('module-sync')).toBe(
        Boolean(process.features.require_module),
      )
      expect(conditionsOf(['--no-addons'])).not.toContain('node-addons')
      expect(conditionsOf(['--conditions=foo'])).toContain('foo')
      expect(conditionsOf(['--no-experimental-require-module'])).not.toContain(
        'module-sync',
      )

      // this thread's argv is always in play, and the worker's is merged on top of it
      process.execArgv.push('--no-addons')
      try {
        expect(conditionsOf([])).not.toContain('node-addons')
        expect(conditionsOf(['--conditions=bar'])).toContain('bar')
      } finally {
        process.execArgv.pop()
      }
    } finally {
      if (pnp === undefined) {
        delete versions.pnp
      } else {
        versions.pnp = pnp
      }
      fs.rmSync(isolatedDir, { force: true, recursive: true })
    }
  })

  test('generateGlobals resolves with the worker ESM conditions', () => {
    const isolatedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'synckit-cond-'))
    const pkgDir = path.join(isolatedDir, 'node_modules', 'cond-shim')

    try {
      fs.mkdirSync(pkgDir, { recursive: true })
      fs.writeFileSync(
        path.join(pkgDir, 'package.json'),
        JSON.stringify({
          name: 'cond-shim',
          version: '1.0.0',
          exports: {
            foo: './foo.js',
            'node-addons': './addons.js',
            import: './import.js',
            default: './default.js',
          },
        }),
      )
      for (const [file, value] of [
        ['foo.js', 'foo'],
        ['addons.js', 'addons'],
        ['import.js', 'import'],
        ['default.js', 'default'],
      ]) {
        fs.writeFileSync(path.join(pkgDir, file), `export default '${value}'\n`)
      }

      const workerPath = path.join(isolatedDir, 'worker.js')
      const shims = [{ moduleName: 'cond-shim', globalName: '__condShim' }]
      fs.writeFileSync(workerPath, '')

      // the loader enables `node-addons`, so that is the entry the worker would import
      expect(generateGlobals(workerPath, shims)).toContain('addons.js')
      // without it, the loader would take the `import` entry, and `--conditions` adds its own
      expect(
        generateGlobals(workerPath, shims, 'import', ['--no-addons']),
      ).toContain('import.js')
      expect(
        generateGlobals(workerPath, shims, 'import', ['--conditions=foo']),
      ).toContain('foo.js')
    } finally {
      fs.rmSync(isolatedDir, { force: true, recursive: true })
    }
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
