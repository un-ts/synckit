import { createRequire } from 'node:module'

import { createSyncFn } from 'synckit'

const require = createRequire(import.meta.url)

const syncFn = createSyncFn(require.resolve('./worker-shim.js'), {
  globalShims: [
    { moduleName: 'synckit', globalName: '__shimProbe', named: null },
  ],
})

console.log('shimmed:', syncFn())
