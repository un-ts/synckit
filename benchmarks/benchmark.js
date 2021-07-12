// @ts-check

const { performance } = require('perf_hooks')

const RUN_TIMES = +process.env.RUN_TIMES || 1000

/**
 * @param {string} name
 * @typedef {{ loadTime:number,runTime:number, totalTime:number }} PerfResult
 * @returns {PerfResult} Perf result
 */
const perfCase = name => {
  const loadStartTime = performance.now()

  const syncFn = require(`./${name}`)

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

const synckit = perfCase('synckit')
const syncThreads = perfCase('sync-threads')
const deasync = perfCase('deasync')
const native = perfCase('native')

/**
 * @param {string} text
 * @returns {string} Kebab cased text
 */
const kebabCase = text =>
  text.replace(/([A-Z]+)/, (_, $1) => '-' + $1.toLowerCase())

class Benchmark {
  /**
   * @param { Object.<string, PerfResult> } perfResults
   */
  constructor(perfResults) {
    const keys = Object.keys(perfResults)
    const baseKey = kebabCase(keys[0])

    const perfTypes = /** @type {Array<keyof PerfResult>} */ ([
      'loadTime',
      'runTime',
      'totalTime',
    ])

    for (const perfType of perfTypes) {
      const basePerf = perfResults[baseKey][perfType]
      this[perfType] = keys.reduce(
        (acc, key) =>
          Object.assign(acc, {
            [key]: perfResults[key][perfType].toFixed(2),
            ...(key === baseKey
              ? null
              : {
                  [`perf ${key}`]: this.perf(
                    basePerf,
                    perfResults[key][perfType],
                  ),
                }),
          }),
        {},
      )
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
    synckit,
    syncThreads,
    deasync,
    native,
  }),
)
