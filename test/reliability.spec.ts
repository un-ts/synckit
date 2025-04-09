import path from 'node:path'

import { _dirname } from './helpers.js'

// eslint-disable-next-line @typescript-eslint/no-magic-numbers
const times = process.env.CI ? 1e5 : 1e3

test(`Reliability (${times} runs)`, async () => {
  const { createSyncFn } = await import('synckit')
  const identity = createSyncFn(path.resolve(_dirname, `./worker-identity.js`))

  for (let index = 0; index < times; index++) {
    try {
      expect(identity(index)).toBe(index)
    } catch (error) {
      console.log(`Failed on ${index + 1} run.`)
      throw error
    }
  }
})
