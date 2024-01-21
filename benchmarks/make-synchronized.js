import { makeSynchronized } from 'make-synchronized'

/** @type {() => string} */
const syncFn = makeSynchronized(new URL('native.cjs', import.meta.url))

/** @type {() => string} */
// More reasonable test?
// const synchronizeOnFly = filename =>
//   makeSynchronized('node:fs/promises').readFile(filename, 'utf8')

export default syncFn
