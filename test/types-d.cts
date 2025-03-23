import expect = require('ts-expect')

import synckit = require('..')

expect.expectType<expect.TypeEqual<synckit.Syncify<() => true>, () => true>>(
  true,
)
