/* eslint-disable @typescript-eslint/no-floating-promises */
import { TypeEqual, expectType } from 'ts-expect'

import {
  AnyPromise,
  createSyncFn,
  PromiseType,
  runAsWorker,
  Syncify,
} from 'synckit'

// @ts-expect-error
expectType<Syncify<() => 1>>(true)

expectType<TypeEqual<Syncify<() => Promise<true>>, () => true>>(true)
expectType<TypeEqual<Syncify<() => AnyPromise>, () => PromiseType<AnyPromise>>>(
  true,
)
expectType<TypeEqual<Syncify<() => Promise<never>>, () => never>>(true)

// @ts-expect-error
createSyncFn<() => 0>('')

// @ts-expect-error
expectType<() => true>(createSyncFn<() => Promise<1>>(''))

expectType<() => true>(createSyncFn<() => Promise<true>>(''))
expectType<() => true>(createSyncFn<() => Promise<never>>(''))

// @ts-expect-error
runAsWorker(() => 1)

runAsWorker<() => Promise<number>>(() => Promise.resolve(1))
