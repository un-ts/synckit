import { resolve } from 'node:path'

import { execaNode } from 'execa'

test('yarn-pnp', async () => {
  const { stdout } = await execaNode('index.js', [], {
    nodeOptions: ['-r', './.pnp.cjs'],
    cwd: resolve('test/fixtures/yarn-pnp'),
  })

  /**
   * @see https://github.com/sindresorhus/execa/issues/587
   */
  expect(stdout).toContain('1')
  expect(stdout).toContain('2')
  expect(stdout).toContain('5')
})
