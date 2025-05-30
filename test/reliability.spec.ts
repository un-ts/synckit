import path from 'node:path'

import { _dirname, testIf } from './helpers.js'

const times = 1e6

const test = testIf(!!process.env.CI)

test(`Reliability (${times} runs)`, async () => {
  const { createSyncFn } = await import('synckit')
  const identity = createSyncFn(path.resolve(_dirname, `./worker-identity.js`))

  for (let index = 0; index < times; index++) {
    try {
      // eslint-disable-next-line jest/no-standalone-expect
      expect(identity(index)).toBe(index)
    } catch (error) {
      console.error(`Failed on ${index + 1}/${times} run.`)
      throw error
    }
  }
})
