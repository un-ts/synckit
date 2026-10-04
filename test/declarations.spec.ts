import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

import { _dirname } from './helpers.js'

import { extractProperties } from 'synckit'

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

test('extractProperties is declared as the property bag it returns', () => {
  const copied = extractProperties(new Error('message'))
  expect(copied).toEqual({})

  // a generic `extractProperties<T extends object>(object: T): T` overload would type this as the
  // error handed in, whose `message` is a string — while the runtime copy has no `message` at all.
  // If that overload came back, this assignment would be legal and the directive would be unused
  // @ts-expect-error -- a property bag is not the Error it was copied from
  const asError: Error = copied
  expect(asError).toEqual({})
})
