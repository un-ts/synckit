import { makeSynchronized } from 'make-synchronized'

/**
 * @param {string} filename
 * @returns {() => string} Syncified function
 */
const syncFn = filename =>
  makeSynchronized('node:fs/promises').readFile(filename, 'utf8')

export default syncFn
