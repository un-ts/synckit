import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { exec } from 'tinyexec'

// every case here spawns a package manager and a worker, which can outlast the default budget when
// the rest of the suite is running beside it
const FIXTURE_TIMEOUT = 30_000

// packing the built package and installing it from the tarball adds a build and a registry
// resolution to the spawn, so that case gets a budget of its own
const PACKED_FIXTURE_TIMEOUT = 180_000

const yarnPnpDir = path.resolve('test/fixtures/yarn-pnp')

test(
  'yarn-pnp',
  async () => {
    const result = await exec('yarn', ['node', 'index.js'], {
      nodeOptions: {
        cwd: yarnPnpDir,
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
        cwd: yarnPnpDir,
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
        cwd: yarnPnpDir,
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
  'yarn-pnp from a packed archive, where the guard lives inside a zip',
  async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'synckit-pnp-packed-'))
    try {
      const tarball = path.join(tmp, 'synckit.tgz')
      const fixture = path.join(tmp, 'fixture')

      // a `file:` tarball is what makes Yarn serve the package from `.yarn/cache/*.zip`. The
      // committed fixture uses `link:`, which leaves synckit on the filesystem and so loads the
      // guard whatever the preload order is — the shape that hid issue #278
      const packed = await exec('yarn', ['pack', '--out', tarball], {
        nodeOptions: { cwd: path.resolve('.'), env: { FORCE_COLOR: '0' } },
      })
      if (packed.exitCode !== 0) {
        throw new Error(`yarn pack failed:\n${packed.stderr}`)
      }

      fs.cpSync(yarnPnpDir, fixture, { recursive: true })
      // the committed map, loader and lockfile describe the `link:` install, not this one
      for (const stale of [
        '.pnp.cjs',
        '.pnp.loader.mjs',
        'yarn.lock',
        '.yarn/install-state.gz',
      ]) {
        fs.rmSync(path.join(fixture, stale), { force: true })
      }

      const manifestPath = path.join(fixture, 'package.json')
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as {
        dependencies: Record<string, string>
      }
      manifest.dependencies.synckit = 'file:../synckit.tgz'
      fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

      const installed = await exec('yarn', ['install'], {
        nodeOptions: { cwd: fixture, env: { FORCE_COLOR: '0' } },
      })
      if (installed.exitCode !== 0) {
        throw new Error(`yarn install failed:\n${installed.stderr}`)
      }

      // the package is served from an archive, so `register.cjs` cannot be read until `.pnp.cjs`
      // has patched module resolution — exactly what the fix has to survive
      expect(fs.readFileSync(path.join(fixture, '.pnp.cjs'), 'utf8')).toContain(
        '.zip/node_modules/synckit/',
      )
      // a regression fails at the deadline instead of hanging the case
      const run = await exec('yarn', ['node', 'index.js'], {
        nodeOptions: {
          cwd: fixture,
          env: { FORCE_COLOR: '0', SYNCKIT_TIMEOUT: '10000' },
        },
      })
      if (run.exitCode !== 0) {
        throw new Error(`yarn node index.js failed:\n${run.stderr}`)
      }
      expect(run.stdout).toContain('1 2 5')
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  },
  PACKED_FIXTURE_TIMEOUT,
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
