import { createRequire } from 'node:module'

import { createSyncFn } from 'synckit'

const require = createRequire(import.meta.url)

const syncFn = createSyncFn(require.resolve('./worker'))

console.log(syncFn(1), syncFn(2), syncFn(5))
