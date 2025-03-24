import path from 'node:path'

import { _dirname } from './helpers.js'

const workerPath = path.resolve(_dirname, './worker-async-identity.js')

// eslint-disable-next-line @typescript-eslint/no-magic-numbers
const times = process.env.CI ? 1e6 : 1e3

test(`Reliability (${times} runs)`, async () => {
  const { createSyncFn } = await import('synckit')
  const identity = createSyncFn(workerPath)

  for (let index = 0; index < times; index++) {
    expect(identity(index)).toBe(index)
  }
})
