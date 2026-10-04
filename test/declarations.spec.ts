import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

import { _dirname } from './helpers.js'

const require = createRequire(import.meta.url)

/**
 * `register.cjs` and `shared.cjs` are hand-written CommonJS with hand-written `.d.cts`
 * companions. The build compiles `src` with `allowJs: false`, so those declarations — not the
 * JavaScript — are what `src` and consumers resolve, and nothing else checks that they agree.
 * A declaration-only export would type-check and then be `undefined` at runtime; a runtime-only
 * export would be invisible to every importer.
 */
const declaredExports = (basename: string) => {
  const declaration = fs.readFileSync(
    path.resolve(_dirname, `../${basename}.d.cts`),
    'utf8',
  )

  return new Set(
    [
      ...declaration.matchAll(
        /^export (?:declare )?(?:const|function) (\w+)/gm,
      ),
    ].map(([, name]) => name),
  )
}

const runtimeExports = (basename: string) =>
  new Set(Object.keys(require(`../${basename}.cjs`) as Record<string, unknown>))

test('register.cjs declarations match its runtime exports', () => {
  expect(declaredExports('register')).toEqual(runtimeExports('register'))
})

test('shared.cjs declarations match its runtime exports', () => {
  expect(declaredExports('shared')).toEqual(runtimeExports('shared'))
})
