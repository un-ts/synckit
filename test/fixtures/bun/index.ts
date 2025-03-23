import { createSyncFn } from 'synckit'

const syncFn = createSyncFn(import.meta.resolve('./worker'))

console.log(syncFn(1), syncFn(2), syncFn(5))
