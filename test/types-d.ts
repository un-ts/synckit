import { expectType, type TypeEqual } from 'ts-expect'

import {
  type AnyPromise,
  type PromiseType,
  type Syncify,
  createSyncFn,
  runAsWorker,
} from 'synckit'

// @ts-expect-error -- intended
expectType<Syncify<() => 1>>(true)

expectType<TypeEqual<Syncify<() => Promise<true>>, () => true>>(true)
expectType<TypeEqual<Syncify<() => AnyPromise>, () => PromiseType<AnyPromise>>>(
  true,
)
expectType<TypeEqual<Syncify<() => Promise<never>>, () => never>>(true)

expectType<(input: 0) => void>(createSyncFn<(input: 0) => Promise<void>>(''))

expectType<() => 1>(createSyncFn<() => Promise<1>>(''))

expectType<() => true>(createSyncFn<() => Promise<true>>(''))
expectType<() => true>(createSyncFn<() => Promise<never>>(''))

// @ts-expect-error -- intended
createSyncFn<() => 0>('')

expectType<void>(runAsWorker(() => Promise.resolve(1)))

// @ts-expect-error -- intended
runAsWorker(() => 1)

runAsWorker<() => Promise<string>>(() =>
  // @ts-expect-error -- intended
  Promise.resolve(1),
)
