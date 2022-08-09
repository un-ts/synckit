import { execSync } from 'node:child_process'
import { resolve } from 'node:path'

test('yarn-pnp', () => {
  expect(
    execSync(`node index.js`, {
      env: {
        NODE_OPTIONS: '-r .pnp.cjs',
      },
      cwd: resolve('test/fixtures/yarn-pnp'),
      encoding: 'utf8',
    }),
  ).toBe([1, 2, 5].join(' '))
})
