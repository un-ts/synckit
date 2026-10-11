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
// pins synckit's runtime deps for the packed install; see the file's header
const packedLockfile = path.resolve('test/fixtures/yarn-pnp-packed.lock')

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
    // resolved to its realpath: where the temp or home directory is a symlink (a NAS home behind
    // `/var/services`), Yarn records the symlinked spelling in the PnP map while Node resolves the
    // loaded entry to the real one, and a file inside the package archive is then not found
    const tmp = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), 'synckit-pnp-packed-')),
    )
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
        throw new Error(`yarn pack failed:\n${packed.stdout}\n${packed.stderr}`)
      }

      fs.cpSync(yarnPnpDir, fixture, { recursive: true })
      // the committed map and loader describe the `link:` install, not this one
      for (const stale of [
        '.pnp.cjs',
        '.pnp.loader.mjs',
        '.yarn/install-state.gz',
      ]) {
        fs.rmSync(path.join(fixture, stale), { force: true })
      }
      // the committed lockfile only pins the `link:` spec and none of synckit's runtime deps, so it
      // is replaced by one that pins them: the install then needs no registry resolution
      fs.copyFileSync(packedLockfile, path.join(fixture, 'yarn.lock'))

      const manifestPath = path.join(fixture, 'package.json')
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as {
        dependencies: Record<string, string>
      }
      manifest.dependencies.synckit = 'file:../synckit.tgz'
      fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

      // Yarn records the archive's location in the PnP map. Where home is a symlink (a NAS home
      // behind `/var/services`), the default global folder is recorded under the symlinked spelling
      // while Node resolves the archive it holds to the realpath — and then cannot find a file
      // inside it. Point the fixture at that same folder by its realpath, which keeps the shared
      // cache warm instead of refilling one beside the fixture
      const configResult = await exec(
        'yarn',
        ['config', 'get', 'globalFolder'],
        {
          nodeOptions: { cwd: path.resolve('.'), env: { FORCE_COLOR: '0' } },
        },
      )
      if (configResult.exitCode !== 0) {
        throw new Error(
          `yarn config get globalFolder failed:\n${configResult.stdout}\n${configResult.stderr}`,
        )
      }
      const defaultGlobalFolder = configResult.stdout.trim()
      fs.mkdirSync(defaultGlobalFolder, { recursive: true })
      const globalFolder = fs.realpathSync(defaultGlobalFolder)
      fs.appendFileSync(
        path.join(fixture, '.yarnrc.yml'),
        `globalFolder: ${JSON.stringify(globalFolder)}\n`,
      )

      // `--no-immutable`: CI makes Yarn treat an install as immutable by default, and the template's
      // `file:` checksum is deliberately stale — Yarn has to refresh it from the tarball just packed
      const installed = await exec('yarn', ['install', '--no-immutable'], {
        nodeOptions: { cwd: fixture, env: { FORCE_COLOR: '0' } },
      })
      if (installed.exitCode !== 0) {
        throw new Error(
          `yarn install failed:\n${installed.stdout}\n${installed.stderr}`,
        )
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
        throw new Error(
          `yarn node index.js failed:\n${run.stdout}\n${run.stderr}`,
        )
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
