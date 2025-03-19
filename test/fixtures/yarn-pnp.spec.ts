import path from 'node:path'

import { execaNode } from 'execa'

test('yarn-pnp', async () => {
  const { stdout } = await execaNode('index.js', [], {
    nodeOptions: ['-r', './.pnp.cjs'],
    cwd: path.resolve('test/fixtures/yarn-pnp'),
    env: {
      FORCE_COLOR: '0',
    },
  })

  expect(stdout).toBe([1, 2, 5].join(' '))
})
