// @ts-check

/* eslint-disable import/order */

const { performance } = require('perf_hooks')

const synckitLoadStartTime = performance.now()

const syncFn1 = require('./synckit')

const synckitLoadTime = performance.now() - synckitLoadStartTime

const syncThreadsLoadStartTime = performance.now()

const syncFn2 = require('./sync-threads')

const syncThreadsLoadTime = performance.now() - syncThreadsLoadStartTime

const nativeLoadStartTime = performance.now()

const syncFn3 = require('./native')

const nativeLoadTime = performance.now() - nativeLoadStartTime

const RUN_TIMES = +process.env.RUN_TIMES || 1000

const synckitRunStartTime = performance.now()

let i = RUN_TIMES

while (i-- > 0) {
  syncFn1()
}

const synckitRuntime = performance.now() - synckitRunStartTime

const syncThreadsRunStartTime = performance.now()

i = RUN_TIMES

while (i-- > 0) {
  syncFn2()
}

const syncThreadsRuntime = performance.now() - syncThreadsRunStartTime

const nativeRunStartTime = performance.now()

i = RUN_TIMES

while (i-- > 0) {
  syncFn3()
}

const nativeRuntime = performance.now() - nativeRunStartTime

class Benchmark {
  /**
   * @param {number} synckit
   * @param {number} syncThreads
   * @param {number} native
   */
  constructor(synckit, syncThreads, native) {
    /**
     * @type {string}
     */
    this.synckit = synckit.toFixed(2) + 'ms'
    /**
     * @type {string}
     */
    this['sync-threads'] = syncThreads.toFixed(2) + 'ms'
    /**
     * @type {string}
     */
    this.native = native.toFixed(2) + 'ms'
    /**
     * @type {string}
     */
    this['perf sync-threads'] = this.perf(synckit, syncThreads)
    /**
     * @type {string}
     */
    this['perf native'] = this.perf(synckit, native)
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

console.table({
  'load time': new Benchmark(
    synckitLoadTime,
    syncThreadsLoadTime,
    nativeLoadTime,
  ),
  'run time': new Benchmark(synckitRuntime, syncThreadsRuntime, nativeRuntime),
  'total time': new Benchmark(
    synckitLoadTime + synckitRuntime,
    syncThreadsLoadTime + syncThreadsRuntime,
    nativeLoadTime + nativeRuntime,
  ),
})
