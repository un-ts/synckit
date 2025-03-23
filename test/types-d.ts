import { expectType, type TypeEqual } from 'ts-expect'

import { type Syncify, createSyncFn, runAsWorker } from 'synckit'

// @ts-expect-error -- intended
expectType<Syncify<() => 1>>(true)

expectType<TypeEqual<Syncify<() => true>, () => true>>(true)
expectType<TypeEqual<Syncify<() => Promise<true>>, () => true>>(true)
expectType<TypeEqual<Syncify<() => never>, () => never>>(true)
expectType<TypeEqual<Syncify<() => Promise<never>>, () => never>>(true)

expectType<(input: 0) => void>(createSyncFn<(input: 0) => void>(''))
expectType<(input: 0) => void>(createSyncFn<(input: 0) => Promise<void>>(''))

expectType<() => 1>(createSyncFn<() => Promise<1>>(''))

expectType<() => true>(createSyncFn<() => true>(''))
expectType<() => true>(createSyncFn<() => Promise<true>>(''))
expectType<() => true>(createSyncFn<() => never>(''))
expectType<() => true>(createSyncFn<() => Promise<never>>(''))

createSyncFn<() => 0>('')

expectType<void>(runAsWorker(() => Promise.resolve(1)))

runAsWorker(() => 1)

runAsWorker(() => Promise.resolve(1))
