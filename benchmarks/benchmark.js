// @ts-check

import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'

const RUN_TIMES = +(process.env.RUN_TIMES || 1000)

const __filename = fileURLToPath(import.meta.url)

/**
 * @param {string} name
 * @typedef {{ loadTime: number, runTime: number, totalTime: number } | undefined} PerfResult
 * @returns {Promise<PerfResult>} Perf result
 */
const perfCase = async name => {
  const loadStartTime = performance.now()

  let syncFn

  try {
    ;({ default: syncFn } = await import(
      `./${name}.${
        name === 'synckit' || name === 'make-synchronized' ? 'js' : 'cjs'
      }`
    ))
  } catch {
    return
  }

  const loadTime = performance.now() - loadStartTime

  let i = RUN_TIMES

  const runStartTime = performance.now()

  while (i-- > 0) {
    syncFn(__filename)
  }

  const runTime = performance.now() - runStartTime

  return {
    loadTime,
    runTime,
    totalTime: runTime + loadTime,
  }
}

/**
 * @param {string} text
 * @returns {string} Kebab cased text
 */
const kebabCase = text =>
  text.replace(/([A-Z]+)/, (_, $1) => '-' + $1.toLowerCase())

class Benchmark {
  /**
   * @param { Record.<string, PerfResult> } perfResults
   */
  constructor(perfResults) {
    const keys = Object.keys(perfResults)
    const _baseKey = keys[0]
    const baseKey = kebabCase(_baseKey)

    const perfTypes = /** @type {const} */ ([
      'loadTime',
      'runTime',
      'totalTime',
    ])

    for (const perfType of perfTypes) {
      const basePerf = perfResults[_baseKey]?.[perfType]
      this[perfType] = keys.reduce((acc, key) => {
        const perfResult = perfResults[key]
        const perfTime = perfResult?.[perfType]
        key = kebabCase(key)
        return Object.assign(acc, {
          [key]: perfTime == null ? 'N/A' : perfTime.toFixed(2) + 'ms',
          ...(key === baseKey
            ? null
            : {
                [`perf ${key}`]:
                  basePerf == null || perfTime == null
                    ? 'N/A'
                    : this.perf(basePerf, perfTime),
              }),
        })
      }, {})
    }
  }

  /**
   * @param {number} a
   * @param {number} b
   * @returns {string} perf description
   */
  perf(a, b) {
    return a === b
      ? 'same'
      : a > b
        ? (a / b).toFixed(2) + 'x slower'
        : (b / a).toFixed(2) + 'x faster'
  }
}

console.table(
  new Benchmark({
    synckit: await perfCase('synckit'),
    syncThreads: await perfCase('sync-threads'),
    deasync: await perfCase('deasync'),
    makeSynchronized: await perfCase('make-synchronized'),
    native: await perfCase('native'),
  }),
)
