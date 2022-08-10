import { resolve } from 'node:path'

import { execaNode } from 'execa'

test('yarn-pnp', async () => {
  const { stdout } = await execaNode('index.js', [], {
    nodeOptions: ['-r', './.pnp.cjs'],
    cwd: resolve('test/fixtures/yarn-pnp'),
  })
  expect(stdout).toBe([1, 2, 5].join(' '))
})
