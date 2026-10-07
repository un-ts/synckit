const { createSyncFn } = require('synckit')

const syncFn = createSyncFn(require.resolve('./worker-shim-cjs.cjs'), {
  globalShims: [
    { moduleName: 'synckit', globalName: '__shimProbe', named: null },
  ],
})

console.log('shimmed-cjs:', syncFn())
