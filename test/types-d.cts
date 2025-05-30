import expect = require('ts-expect')

import synckit = require('synckit')

expect.expectType<expect.TypeEqual<synckit.Syncify<() => true>, () => true>>(
  true,
)
