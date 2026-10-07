import path from 'node:path'

import { exec } from 'tinyexec'

// every case here spawns a package manager and a worker, which can outlast the default budget when
// the rest of the suite is running beside it
const FIXTURE_TIMEOUT = 30_000

test(
  'yarn-pnp',
  async () => {
    const result = await exec('yarn', ['node', 'index.js'], {
      nodeOptions: {
        cwd: path.resolve('test/fixtures/yarn-pnp'),
        env: {
          FORCE_COLOR: '0',
        },
      },
    })

    expect(result).toMatchSnapshot()
  },
  FIXTURE_TIMEOUT,
)

test(
  'yarn-pnp global shims',
  async () => {
    // the shim specifier is resolved through `pnpapi` with the worker as the issuer, so the PnP map
    // has to resolve it there rather than the loader falling back to the working directory
    const result = await exec('yarn', ['node', 'shim.js'], {
      nodeOptions: {
        cwd: path.resolve('test/fixtures/yarn-pnp'),
        env: {
          FORCE_COLOR: '0',
        },
      },
    })

    expect(result.stdout.trim()).toBe('shimmed: object')
  },
  FIXTURE_TIMEOUT,
)

test(
  'yarn-pnp global shims (CommonJS)',
  async () => {
    // the CommonJS path needs no PnP-specific resolution: the runtime patches the resolver in both
    // threads, so the `createRequire(workerPath)` the check and the prelude use consults the PnP map
    const result = await exec('yarn', ['node', 'shim-cjs.cjs'], {
      nodeOptions: {
        cwd: path.resolve('test/fixtures/yarn-pnp'),
        env: {
          FORCE_COLOR: '0',
        },
      },
    })

    expect(result.stdout.trim()).toBe('shimmed-cjs: object')
  },
  FIXTURE_TIMEOUT,
)

test(
  'bun',
  async () => {
    const result = await exec('bun', ['index.ts'], {
      nodeOptions: {
        cwd: path.resolve('test/fixtures/bun'),
        env: {
          FORCE_COLOR: '0',
        },
      },
    })

    expect(result).toMatchSnapshot()
  },
  FIXTURE_TIMEOUT,
)
