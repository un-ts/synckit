import path from 'node:path'

import { exec } from 'tinyexec'

test('yarn-pnp', async () => {
  const result = await exec('yarn', ['node', 'index.js'], {
    nodeOptions: {
      cwd: path.resolve('test/fixtures/yarn-pnp'),
      env: {
        FORCE_COLOR: '0',
      },
    },
  })

  expect(result).toMatchSnapshot()
})

test('bun', async () => {
  const result = await exec('bun', ['index.ts'], {
    nodeOptions: {
      cwd: path.resolve('test/fixtures/bun'),
      env: {
        FORCE_COLOR: '0',
      },
    },
  })

  expect(result).toMatchSnapshot()
})
