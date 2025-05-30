// @ts-check

const { performance } = require('node:perf_hooks')

const RUN_TIMES = +(process.env.RUN_TIMES || 1000)

/**
 * @param {string} name
 * @typedef {{ loadTime: number, runTime: number, totalTime: number } | void} PerfResult
 * @returns {PerfResult | void} Perf result
 */
const perfCase = name => {
  const loadStartTime = performance.now()

  let syncFn

  try {
    syncFn = require(`./${name}.cjs`)
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
   * @param { Record<string, PerfResult> } perfResults
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
        const prefTime = perfResult?.[perfType]
        key = kebabCase(key)
        return Object.assign(acc, {
          [key]: prefTime == null ? 'N/A' : prefTime.toFixed(2) + 'ms',
          ...(key === baseKey
            ? null
            : {
                [`perf ${key}`]:
                  basePerf == null || prefTime == null
                    ? 'N/A'
                    : this.perf(basePerf, prefTime),
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
    synckit: perfCase('synckit'),
    syncThreads: perfCase('sync-threads'),
    deasync: perfCase('deasync'),
    makeSynchronized: perfCase('make-synchronized'),
    native: perfCase('native'),
  }),
)
