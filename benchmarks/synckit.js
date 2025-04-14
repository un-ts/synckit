import { createRequire } from 'node:module'

import { createSyncFn } from '../lib/index.js'

const cjsRequire = createRequire(import.meta.url)

/** @type {() => string} */
const syncFn = createSyncFn(cjsRequire.resolve('./synckit.worker'))

export default syncFn
