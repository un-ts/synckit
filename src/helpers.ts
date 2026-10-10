import { createHash } from 'node:crypto'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  MessageChannel,
  Worker,
  receiveMessageOnPort,
} from 'node:worker_threads'
import type { MessagePort } from 'node:worker_threads'

import { moduleResolve } from '@dual-bundle/import-meta-resolve'
import { tryExtensions, findUp, cjsRequire, isPkgAvailable } from '@pkgr/core'

import {
  NODE_OPTIONS,
  NOTIFY_INDEX,
  createSharedBufferView,
  getFlag,
  getFlagValues,
} from '../shared.cjs'

import { compareNodeVersion } from './common.js'
import {
  DEFAULT_EXEC_ARGV,
  DEFAULT_GLOBAL_SHIMS,
  DEFAULT_GLOBAL_SHIMS_PRESET,
  DEFAULT_TIMEOUT,
  DEFAULT_TS_RUNNER,
  DEFAULT_TYPES_NODE_VERSION,
  IMPORT_FLAG,
  IMPORT_FLAG_SUPPORTED,
  LOADER_FLAG,
  LOADER_FLAGS,
  MTS_SUPPORTED,
  NO_STRIP_TYPES,
  NO_STRIP_TYPES_FLAG,
  REQUIRE_ABBR_FLAG,
  REQUIRE_FLAGS,
  STRIP_TYPES_FLAG,
  STRIP_TYPES_NODE_VERSION,
  TRANSFORM_TYPES_FLAG,
  TRANSFORM_TYPES_NODE_VERSION,
  TS_ESM_PARTIAL_SUPPORTED,
  TsRunner,
} from './constants.js'
import type {
  AnyFn,
  GlobalShim,
  MainToWorkerCommandMessage,
  MainToWorkerMessage,
  PackageJson,
  StdioChunk,
  SynckitOptions,
  WorkerFailureMessage,
  WorkerToMainMessage,
} from './types.js'

// The shared buffer and its notification byte live in `shared.cjs`, and the load guard that uses
// them at the worker's end lives in `register.cjs` — both plain CommonJS files at the package
// root, so that `register.cjs` reaches the worker unchanged with `-r` in development, where a
// test runner maps the package to its source, and in the published package alike; `shared.cjs`
// reaches it because `register.cjs` requires it.

export const isFile = (path: string) => {
  try {
    return !!fs.statSync(path, { throwIfNoEntry: false })?.isFile()
  } catch {
    /* istanbul ignore next */
    return false
  }
}

/**
 * Whether a package can be resolved from a file the way a `require` would.
 *
 * `isPkgAvailable` resolves from `@pkgr/core`'s own location, which is only one of the places a
 * global shim may live. The CommonJS eval path loads the shims with a `require` bound to the
 * worker, so availability has to be judged from there or a shim which only exists beside the worker
 * is filtered out before it can be loaded, and one that `require` cannot reach is kept and then
 * fails.
 *
 * @param pkg - The module name to resolve.
 * @param base - The absolute path of the file the resolution starts from.
 */
const isPkgAvailableFrom = (pkg: string, base: string) => {
  try {
    createRequire(base).resolve(pkg)
    return true
  } catch {
    return false
  }
}

// `--conditions` accumulates, so every occurrence counts, and `-C` is its short form
const CONDITIONS_FLAGS = new Set(['--conditions', '-C'])

/**
 * Whether `require(esm)` — and with it the `module-sync` condition — is on by default for this
 * Node.
 *
 * The 20.x line got the backport in 20.19, the 22.x line in 22.12, and 23 and later started with it.
 * 21.x never had it, and 22.0–22.11 needed `--experimental-require-module`.
 */
const requireModuleByDefault =
  compareNodeVersion('22.12.0') >= 0 ||
  // 20.19 alone would also match 21.x and 22.0–22.11, where it is off, so the range ends at 21
  (compareNodeVersion('20.19.0') >= 0 && compareNodeVersion('21') < 0)

/**
 * Whether `require(esm)` is on for the worker, which is what enables the `module-sync` condition.
 *
 * It follows the worker's argv merged over this thread's and otherwise the default above.
 *
 * @param execArgv - The argv the worker is started with.
 */
const hasRequireModule = (execArgv: string[]) =>
  getFlag('--no-experimental-require-module', undefined, execArgv) == null &&
  (getFlag('--experimental-require-module', undefined, execArgv) != null ||
    requireModuleByDefault)

/**
 * The export conditions the worker's own `import` resolves with.
 *
 * `node` and `import` are always there, `node-addons` unless `--no-addons` is set, `module-sync`
 * once `require(esm)` is on, and whatever `--conditions` adds. They are read from this thread's argv
 * and the argv the worker is started with, which is merged on top of it.
 *
 * @param execArgv - The argv the worker is started with.
 */
const esmConditions = (execArgv: string[]) =>
  new Set([
    'node',
    'import',
    ...(getFlag('--no-addons', undefined, execArgv) == null
      ? ['node-addons']
      : []),
    ...(hasRequireModule(execArgv) ? ['module-sync'] : []),
    ...getFlagValues(CONDITIONS_FLAGS, execArgv),
  ])

/** The part of Yarn's PnP API shim resolution uses. */
interface PnpApi {
  resolveRequest: (
    request: string,
    issuer: string,
    options?: { conditions?: Set<string> },
  ) => string | null
}

/**
 * Resolves an ESM specifier the way the worker's own `import` would.
 *
 * `import` resolves against the importing module, and the generated entry is a `data:` URL with no
 * directory of its own, so this has to answer from the worker's path, with the worker's conditions.
 * Node's own resolver did not take a parent before 20.16 and cannot see the PnP map, so the ponyfill
 * covers `node_modules` and `pnpapi` covers PnP, both with the worker as the parent.
 *
 * @param specifier - The module name to resolve.
 * @param workerPath - The absolute path of the worker module.
 * @param conditions - The export conditions the worker resolves with.
 * @returns The absolute URL to import, or the specifier itself for a builtin.
 * @throws When the specifier cannot be resolved from the worker.
 */
const resolveEsmImport = (
  specifier: string,
  workerPath: string,
  conditions: Set<string>,
) => {
  if (process.versions.pnp) {
    // `pnpapi` is only resolvable from inside the PnP project, so it is asked for from the worker's
    // own path rather than the package's, which may sit in a `node_modules` fallback
    const pnp = createRequire(workerPath)('pnpapi') as unknown as PnpApi

    const resolved = pnp.resolveRequest(specifier, workerPath, { conditions })

    // PnP answers `null` for a builtin, which is already an importable specifier
    return resolved == null ? specifier : pathToFileURL(resolved).href
  }

  return moduleResolve(specifier, pathToFileURL(workerPath), conditions, false)
    .href
}

/**
 * Whether a package can be resolved from a file the way an `import` would.
 *
 * Judged with {@link resolveEsmImport}, so the check cannot keep a shim the generated statements
 * cannot import, or drop one they could.
 *
 * @param pkg - The module name to resolve.
 * @param workerPath - The absolute path of the worker module.
 * @param conditions - The export conditions the worker resolves with.
 */
const isPkgImportableFrom = (
  pkg: string,
  workerPath: string,
  conditions: Set<string>,
) => {
  try {
    resolveEsmImport(pkg, workerPath, conditions)
    return true
  } catch {
    return false
  }
}

export const dataUrl = (code: string) =>
  new URL(`data:text/javascript,${encodeURIComponent(code)}`)

// only `extractProperties` was part of the public surface before it moved into `shared.cjs`;
// the other internals stay internal
export { extractProperties } from '../shared.cjs'

// MessagePort does not copy an error's own properties, so they are merged back in on this
// side. A reason that is not an object is thrown as it came: `Object.assign` would box a
// primitive into a `String`/`Number` object with no `message`.
const withProperties = (error: unknown, properties?: object) =>
  error && typeof error === 'object' ? Object.assign(error, properties) : error

// A tuning knob rather than a derived bound: how many consecutive empty port reads a still-pending
// notification is retried for before the loop stops spinning and sleeps a slice instead. It covers
// the hand-off between the worker's post and this thread seeing the message. See
// `receiveMessageWithId`.
const EMPTY_PORT_READS = 100_000

// How long that sleep lasts. The counter is non-zero at that point — which is why the loop cannot
// simply wait on it — so this also bounds how late a message that arrives without a notification of
// its own can be read. See `receiveMessageWithId`.
const EMPTY_PORT_READ_SLICE = 10

// The code the warning about the relaxed guard ordering carries, so a project can silence exactly
// this one. There is deliberately no deadline to go with it: any finite cap on that path would cap
// legitimate work too, so the caller's own timeout stays the only bound. See `startWorkerThread`.
const FALLBACK_WARNING_CODE = 'SYNCKIT_GUARD_ORDERING'

/**
 * Tells a worker to stop working on a request this thread has given up waiting for, so that its
 * late answer is not posted at all.
 *
 * @param mainPort - The port the worker answers on.
 * @param id - The id of the abandoned request.
 */
const abortRequest = (mainPort: MessagePort, id: number) => {
  const abortMsg: MainToWorkerCommandMessage = { id, cmd: 'abort' }

  mainPort.postMessage(abortMsg)
}

/**
 * Handles one empty port read: reports a deadline that has passed, and once the spin bound is
 * reached sleeps a bounded slice on the value the counter holds. Waiting on that value rather than
 * on `0` keeps a pending notification — whose message may still arrive — from being spent before it
 * does, and a new notification changes the value and returns early. Nothing here touches the
 * counter, so it cannot drift.
 *
 * @param sharedBufferView - This worker's slice of the shared buffer.
 * @param emptyReads - How many consecutive empty reads there have been.
 * @param deadline - When the call's budget runs out, or `undefined` when it has none.
 * @param remaining - Milliseconds left of that budget, or `undefined`.
 * @param mainPort - The port the worker answers on, for the abort a passed deadline sends.
 * @param expectedId - The id of the request this call is waiting for.
 * @returns The new count of consecutive empty reads.
 */
const noteEmptyRead = (
  sharedBufferView: Int32Array,
  emptyReads: number,
  deadline: number | undefined,
  remaining: number | undefined,
  mainPort: MessagePort,
  expectedId: number,
) => {
  // a pending notification keeps `Atomics.wait` returning at once, so the deadline has to be taken
  // here as well: only a zero counter lets that wait time out by itself. The worker is told to stop
  // exactly as the wait's own timeout does, or it would answer a request nobody is waiting for
  if (deadline != null && Date.now() >= deadline) {
    abortRequest(mainPort, expectedId)
    throw new Error('Internal error: Atomics.wait() failed: timed-out')
  }

  const reads = emptyReads + 1

  if (reads % EMPTY_PORT_READS === 0) {
    Atomics.wait(
      sharedBufferView,
      NOTIFY_INDEX,
      Atomics.load(sharedBufferView, NOTIFY_INDEX),
      Math.min(remaining ?? EMPTY_PORT_READ_SLICE, EMPTY_PORT_READ_SLICE),
    )
  }

  return reads
}

export const hasRequireFlag = (execArgv: string[]) =>
  execArgv.some(execArg => REQUIRE_FLAGS.has(execArg))

export const hasImportFlag = (execArgv: string[]) =>
  execArgv.includes(IMPORT_FLAG)

export const hasLoaderFlag = (execArgv: string[]) =>
  execArgv.some(execArg => LOADER_FLAGS.has(execArg))

export const setupTsRunner = (
  workerPath: string,
  {
    execArgv = DEFAULT_EXEC_ARGV,
    tsRunner,
  }: { execArgv?: string[]; tsRunner?: TsRunner } = {}, // eslint-disable-next-line sonarjs/cognitive-complexity
) => {
  let ext = path.extname(workerPath)

  if (
    !/([/\\])node_modules\1/.test(workerPath) &&
    (!ext || /^\.[cm]?js$/.test(ext))
  ) {
    const workPathWithoutExt = ext
      ? workerPath.slice(0, -ext.length)
      : workerPath
    let extensions: string[]
    switch (ext) {
      case '.cjs': {
        extensions = ['.cts', '.cjs']
        break
      }
      case '.mjs': {
        extensions = ['.mts', '.mjs']
        break
      }
      default: {
        extensions = ['.ts', '.js']
        break
      }
    }
    const found = tryExtensions(workPathWithoutExt, extensions)
    let differentExt: boolean | undefined
    if (found && (!ext || (differentExt = found !== workPathWithoutExt))) {
      workerPath = found
      if (differentExt) {
        ext = path.extname(workerPath)
      }
    }
  }

  const isTs = /\.[cm]?ts$/.test(workerPath)

  let jsUseEsm = ext === '.mjs'
  let tsUseEsm = ext === '.mts'

  if (isTs) {
    if (!tsUseEsm && ext !== '.cts') {
      const pkg = findUp(workerPath)
      if (pkg) {
        tsUseEsm = cjsRequire<PackageJson>(pkg).type === 'module'
      }
    }

    const stripTypesIndex = execArgv.indexOf(STRIP_TYPES_FLAG)
    const transformTypesIndex = execArgv.indexOf(TRANSFORM_TYPES_FLAG)
    const noStripTypesIndex = execArgv.indexOf(NO_STRIP_TYPES_FLAG)

    const execArgvNoStripTypes =
      noStripTypesIndex > stripTypesIndex ||
      noStripTypesIndex > transformTypesIndex

    const noStripTypes =
      execArgvNoStripTypes ||
      (stripTypesIndex === -1 && transformTypesIndex === -1 && NO_STRIP_TYPES)

    if (tsRunner == null) {
      if (process.versions.bun) {
        tsRunner = TsRunner.Bun
      } else if (
        !noStripTypes &&
        // >=
        compareNodeVersion(STRIP_TYPES_NODE_VERSION) >= 0
      ) {
        tsRunner = TsRunner.Node
      } else if (isPkgAvailable(TsRunner.TsNode)) {
        tsRunner = TsRunner.TsNode
      }
    }

    switch (tsRunner) {
      case TsRunner.Bun: {
        break
      }
      case TsRunner.Node: {
        // <
        if (compareNodeVersion(STRIP_TYPES_NODE_VERSION) < 0) {
          throw new Error(
            'type stripping is not supported in this node version',
          )
        }

        if (noStripTypes) {
          throw new Error('type stripping is disabled explicitly')
        }

        // >=
        if (compareNodeVersion(DEFAULT_TYPES_NODE_VERSION) >= 0) {
          break
        }

        if (
          // >=
          compareNodeVersion(TRANSFORM_TYPES_NODE_VERSION) >= 0 &&
          !execArgv.includes(TRANSFORM_TYPES_FLAG)
        ) {
          execArgv = [TRANSFORM_TYPES_FLAG, ...execArgv]
        } else if (
          // >=
          compareNodeVersion(STRIP_TYPES_NODE_VERSION) >= 0 &&
          !execArgv.includes(STRIP_TYPES_FLAG)
        ) {
          execArgv = [STRIP_TYPES_FLAG, ...execArgv]
        }

        break
      }
      // https://github.com/TypeStrong/ts-node#node-flags-and-other-tools
      case TsRunner.TsNode: {
        if (tsUseEsm) {
          if (!execArgv.includes(LOADER_FLAG)) {
            execArgv = [LOADER_FLAG, `${TsRunner.TsNode}/esm`, ...execArgv]
          }
        } else if (!hasRequireFlag(execArgv)) {
          execArgv = [
            REQUIRE_ABBR_FLAG,
            `${TsRunner.TsNode}/register`,
            ...execArgv,
          ]
        }
        break
      }
      // https://github.com/egoist/esbuild-register#usage
      case TsRunner.EsbuildRegister: {
        if (tsUseEsm) {
          if (!hasLoaderFlag(execArgv)) {
            execArgv = [
              LOADER_FLAG,
              `${TsRunner.EsbuildRegister}/loader`,
              ...execArgv,
            ]
          }
        } else if (!hasRequireFlag(execArgv)) {
          execArgv = [REQUIRE_ABBR_FLAG, TsRunner.EsbuildRegister, ...execArgv]
        }
        break
      }
      // https://github.com/folke/esbuild-runner#-usage
      case TsRunner.EsbuildRunner: {
        if (!hasRequireFlag(execArgv)) {
          execArgv = [
            REQUIRE_ABBR_FLAG,
            `${TsRunner.EsbuildRunner}/register`,
            ...execArgv,
          ]
        }
        break
      }
      // https://github.com/oxc-project/oxc-node#usage
      case TsRunner.OXC: {
        if (!execArgv.includes(IMPORT_FLAG)) {
          execArgv = [
            IMPORT_FLAG,
            `@${TsRunner.OXC}-node/core/register`,
            ...execArgv,
          ]
        }
        break
      }
      // https://github.com/swc-project/swc-node#usage
      case TsRunner.SWC: {
        if (tsUseEsm) {
          if (IMPORT_FLAG_SUPPORTED) {
            if (!hasImportFlag(execArgv)) {
              execArgv = [
                IMPORT_FLAG,
                `@${TsRunner.SWC}-node/register/esm-register`,
                ...execArgv,
              ]
            }
          } else if (!hasLoaderFlag(execArgv)) {
            execArgv = [
              LOADER_FLAG,
              `@${TsRunner.SWC}-node/register/esm`,
              ...execArgv,
            ]
          }
        } else if (!hasRequireFlag(execArgv)) {
          execArgv = [
            REQUIRE_ABBR_FLAG,
            `@${TsRunner.SWC}-node/register`,
            ...execArgv,
          ]
        }
        break
      }
      // https://tsx.is/dev-api/node-cli#node-js-cli
      case TsRunner.TSX: {
        if (IMPORT_FLAG_SUPPORTED) {
          if (!execArgv.includes(IMPORT_FLAG)) {
            execArgv = [IMPORT_FLAG, TsRunner.TSX, ...execArgv]
          }
        } else if (!execArgv.includes(LOADER_FLAG)) {
          execArgv = [LOADER_FLAG, TsRunner.TSX, ...execArgv]
        }
        break
      }
      default: {
        throw new Error(`Unknown ts runner: ${String(tsRunner)}`)
      }
    }
  } else if (!jsUseEsm && ext !== '.cjs') {
    const pkg = findUp(workerPath)
    if (pkg) {
      jsUseEsm = cjsRequire<PackageJson>(pkg).type === 'module'
    }
  }

  // resolved even when the project already preloads it: the worker's own `NODE_OPTIONS` puts its
  // guard behind this require, so `startWorkerThread` needs the path either way
  let pnpApiPath: string | undefined
  let resolvedPnpLoaderPath: string | undefined

  /* istanbul ignore if -- https://github.com/facebook/jest/issues/5274 */
  if (process.versions.pnp) {
    try {
      /** @see https://github.com/facebook/jest/issues/9543 */
      pnpApiPath = cjsRequire.resolve('pnpapi')
    } catch {}
    // a `--require`/`-r` that already loads the pnp API is skipped; only a value equal to it counts.
    // The require itself is not added here: the worker is given it through its own `NODE_OPTIONS`,
    // which the runtime applies before `execArgv`, so adding it here as well would only duplicate it
    if (
      pnpApiPath &&
      !getFlag(REQUIRE_FLAGS, pnpApiPath) &&
      !execArgv.includes(pnpApiPath)
    ) {
      const pnpLoaderPath = path.resolve(pnpApiPath, '../.pnp.loader.mjs')
      if (isFile(pnpLoaderPath)) {
        // Transform path to file URL because nodejs does not accept
        // absolute Windows paths in the --experimental-loader option.
        // https://github.com/un-ts/synckit/issues/123
        resolvedPnpLoaderPath = pathToFileURL(pnpLoaderPath).href
        execArgv = [LOADER_FLAG, resolvedPnpLoaderPath, ...execArgv]
      }
    }
  }

  return {
    ext,
    isTs,
    jsUseEsm,
    tsRunner,
    tsUseEsm,
    workerPath,
    pnpApiPath,
    pnpLoaderPath: resolvedPnpLoaderPath,
    execArgv,
  }
}

export const md5Hash = (text: string) =>
  // eslint-disable-next-line sonarjs/hashing
  createHash('md5').update(text).digest('hex')

export const encodeImportModule = (
  moduleNameOrGlobalShim: GlobalShim | string,
  type: 'import' | 'require' = 'import',
  // eslint-disable-next-line sonarjs/cognitive-complexity
) => {
  const { moduleName, globalName, named, conditional }: GlobalShim =
    typeof moduleNameOrGlobalShim === 'string'
      ? { moduleName: moduleNameOrGlobalShim }
      : moduleNameOrGlobalShim
  const importStatement =
    type === 'import'
      ? `import${
          globalName
            ? ' ' +
              (named === null
                ? '* as ' + globalName
                : named?.trim()
                  ? `{${named}}`
                  : globalName) +
              ' from'
            : ''
        } ${JSON.stringify(
          path.isAbsolute(moduleName) ? pathToFileURL(moduleName) : moduleName,
        )}`
      : `${
          globalName
            ? 'const ' + (named?.trim() ? `{${named}}` : globalName) + '='
            : ''
        }require(${JSON.stringify(moduleName)})`

  if (!globalName) {
    return importStatement
  }

  const overrideStatement = `globalThis.${globalName}=${
    named?.trim() ? named : globalName
  }`

  return (
    importStatement +
    (conditional === false
      ? `;${overrideStatement}`
      : `;if(!globalThis.${globalName})${overrideStatement}`)
  )
}

/** @internal */
export const _generateGlobals = (
  globalShims: GlobalShim[],
  type: 'import' | 'require',
) =>
  globalShims.reduce(
    (acc, shim) => `${acc}${acc ? ';' : ''}${encodeImportModule(shim, type)}`,
    '',
  )

const _dirname =
  typeof __dirname === 'undefined'
    ? path.dirname(fileURLToPath(import.meta.url))
    : /* istanbul ignore next */ __dirname

/**
 * Generates the global shim statements loaded before a worker module.
 *
 * A CommonJS worker can rebind `require` where the statements run, so they keep the bare module
 * names and the caller wraps them. An ESM worker cannot: `import` resolves against the importing
 * module, and the generated entry is a `data:` URL with no directory of its own, so each specifier
 * is resolved against `workerPath` here and emitted as an absolute `file:`/`node:` URL. That is what
 * makes a shim resolvable beside the worker — but not from the package's own `node_modules` — work,
 * rather than a generated file under `node_modules/.synckit` deciding where it resolves.
 *
 * Yarn PnP resolves through a map rather than `node_modules`, so {@link resolveEsmImport} uses
 * `pnpapi` there instead of the ponyfill; both answer from `workerPath`.
 *
 * @param workerPath - The absolute path of the worker module.
 * @param globalShims - The shims to apply.
 * @param type - Whether the caller loads them with `import` or `require`.
 * @param execArgv - The argv the worker is started with, merged over this thread's for the ESM
 *   conditions.
 * @returns The statements, or an empty string when there are no shims.
 */
export const generateGlobals = (
  workerPath: string,
  globalShims: GlobalShim[],
  type: 'import' | 'require' = 'import',
  execArgv: string[] = [],
) => {
  if (globalShims.length === 0) {
    return ''
  }

  if (type === 'require') {
    return _generateGlobals(globalShims, 'require')
  }

  const conditions = esmConditions(execArgv)

  return _generateGlobals(
    globalShims.map(shim => ({
      ...shim,
      moduleName: resolveEsmImport(shim.moduleName, workerPath, conditions),
    })),
    'import',
  )
}

/**
 * Binds the `require` of generated CommonJS global shim statements to the worker's own path.
 *
 * A worker started with `eval: true` runs its entry as a top-level script, and `require` there is a
 * property of the global object resolved from the process working directory, so a bare
 * `require('<shim>')` reaches the wrong location. A shim which is resolvable beside the worker but
 * not from there then fails with `MODULE_NOT_FOUND`.
 *
 * The statements are wrapped in a block which rebinds `require` itself to
 * `createRequire(workerPath)`, so they resolve where the worker is while the entry's global
 * `require` — which loads the worker module by absolute path afterwards, outside the block — is left
 * untouched. The block-scoped `const` shadows that global, so its own initializer cannot name
 * `require` directly: that is a temporal dead zone error, and reading it back through
 * `globalThis.require` is the same binding the statements would otherwise call.
 * `process.getBuiltinModule` is not an option, because it only exists from Node 20.16 and this
 * package supports far older ones.
 *
 * It is a block-scoped `const` inside a block statement rather than a generated function or arrow
 * literal, which code scanning reads as constructed code (`js/bad-code-sanitization`).
 *
 * The worker path is embedded with `JSON.stringify`, so quotes, backslashes and line terminators
 * cannot break out of the literal.
 *
 * @param workerPath - The absolute path of the worker module.
 * @param globals - The generated CommonJS shim statements, possibly empty.
 */
const requireGlobalsFromWorker = (workerPath: string, globals: string) =>
  globals
    ? `{const require=globalThis.require('node:module').createRequire(${JSON.stringify(
        workerPath,
      )});${globals}}`
    : globals

/**
 * Absolute path of the module preloaded into every worker to arm the load guard.
 *
 * `register.cjs` ships with the package, next to the package root: `lib/../register.cjs` in
 * the built package, `src/../register.cjs` in this repository, so the one relative path covers
 * a test run and a release alike.
 */
const workerPreload = path.resolve(_dirname, '../register.cjs')

/**
 * Spawns a worker thread and returns a synchronous function to dispatch tasks.
 *
 * The function initializes a worker thread with the specified script and
 * configuration, setting up a dedicated message channel for bidirectional
 * communication. It applies TypeScript runner settings, execution arguments,
 * and global shims as needed. The returned function sends tasks to the worker,
 * waits synchronously for a response using shared memory synchronization, and
 * then returns the computed result.
 *
 * @param workerPath - The file path of the worker script to execute.
 * @param options - An object containing configuration parameters:
 *
 *   - Timeout: Maximum time in milliseconds to wait for the worker's response.
 *   - ExecArgv: Array of Node.js execution arguments for the worker.
 *   - TsRunner: Specifies the TypeScript runner to use if the worker script is
 *       TypeScript.
 *   - TransferList: List of additional transferable objects to pass to the worker.
 *   - GlobalShims: Modules to import as global shims; if true, a default preset is
 *       used.
 *
 * @returns A synchronous function that accepts task arguments intended for the
 *   worker thread and returns its result.
 * @throws {Error} If a TypeScript runner is required but not specified, or if
 *   an unsupported TypeScript runner is used for the file type.
 * @throws {Error} If internal synchronization fails or if the message
 *   identifier does not match the expected value.
 */
export function startWorkerThread<T extends AnyFn, R = Awaited<ReturnType<T>>>( // eslint-disable-line sonarjs/cognitive-complexity
  workerPath: string,
  {
    timeout = DEFAULT_TIMEOUT,
    execArgv = DEFAULT_EXEC_ARGV,
    tsRunner = DEFAULT_TS_RUNNER,
    transferList = [],
    globalShims = DEFAULT_GLOBAL_SHIMS,
  }: SynckitOptions = {},
) {
  const { port1: mainPort, port2: workerPort } = new MessageChannel()

  // A nested worker can forward the arguments this code added at the level above, guard pair
  // included. That pair is not a register the caller asked for, and `setupTsRunner` reads exactly
  // that to decide whether to add a TypeScript runner, so it goes before the runner is selected. It
  // only ever leads, because this code is what puts it there — the same positional test the
  // `inheritsGuard` check makes on `NODE_OPTIONS` — and it is added again after the selection, so it
  // stays one pair per level instead of one per nesting level
  execArgv =
    execArgv[0] === REQUIRE_ABBR_FLAG && execArgv[1] === workerPreload
      ? execArgv.slice(2)
      : execArgv

  const {
    isTs,
    ext,
    jsUseEsm,
    tsUseEsm,
    tsRunner: finalTsRunner,
    workerPath: finalWorkerPath,
    pnpApiPath,
    pnpLoaderPath,
    execArgv: finalExecArgv,
  } = setupTsRunner(workerPath, { execArgv, tsRunner })

  const workerPathUrl = pathToFileURL(finalWorkerPath)

  if (/\.[cm]ts$/.test(finalWorkerPath)) {
    const isTsxSupported = !tsUseEsm || TS_ESM_PARTIAL_SUPPORTED
    /* istanbul ignore if */
    if (!finalTsRunner) {
      throw new Error('No ts runner specified, ts worker path is not supported')
    } /* istanbul ignore if */ else if (
      (
        [
          // https://github.com/egoist/esbuild-register/issues/96
          TsRunner.EsbuildRegister,
          // https://github.com/folke/esbuild-runner/issues/67
          TsRunner.EsbuildRunner,
          ...(TS_ESM_PARTIAL_SUPPORTED
            ? [
                TsRunner.OXC,
                // https://github.com/swc-project/swc-node/issues/667
                TsRunner.SWC,
              ]
            : []),
          .../* istanbul ignore next */ (isTsxSupported ? [] : [TsRunner.TSX]),
        ] as TsRunner[]
      ).includes(finalTsRunner)
    ) {
      throw new Error(
        `${finalTsRunner} is not supported for ${ext} files yet` +
          /* istanbul ignore next */ (isTsxSupported
            ? ', you can try [tsx](https://github.com/esbuild-kit/tsx) instead'
            : MTS_SUPPORTED
              ? ', you can try [oxc](https://github.com/oxc-project/oxc-node) or [swc](https://github.com/swc-project/swc-node/tree/master/packages/register) instead'
              : ''),
      )
    }
  }

  // Both entries resolve the shims from the worker itself: the CommonJS one with a `require` bound
  // to `workerPath`, the ESM one against the worker's URL. Judging availability anywhere else could
  // keep a shim the entry cannot load, or drop one it could
  const isCjsWorker = isTs ? !tsUseEsm : !jsUseEsm
  // what the shims are resolved with: this thread's argv and the argv the worker is started with
  const esmWorkerConditions = esmConditions(finalExecArgv)

  const finalGlobalShims = (
    globalShims === true
      ? DEFAULT_GLOBAL_SHIMS_PRESET
      : Array.isArray(globalShims)
        ? globalShims
        : []
  ).filter(({ moduleName }) =>
    isCjsWorker
      ? isPkgAvailableFrom(moduleName, finalWorkerPath)
      : isPkgImportableFrom(moduleName, finalWorkerPath, esmWorkerConditions),
  )

  const sharedBufferView = createSharedBufferView()

  const useGlobals = finalGlobalShims.length > 0

  const useEval = isTs ? !tsUseEsm : !jsUseEsm && useGlobals

  const workerEntry =
    (jsUseEsm && useGlobals) || (tsUseEsm && finalTsRunner === TsRunner.TsNode)
      ? dataUrl(
          `${generateGlobals(
            finalWorkerPath,
            finalGlobalShims,
            'import',
            finalExecArgv,
          )};import ${JSON.stringify(String(workerPathUrl))}`,
        )
      : useEval
        ? `${requireGlobalsFromWorker(
            finalWorkerPath,
            generateGlobals(finalWorkerPath, finalGlobalShims, 'require'),
          )};${encodeImportModule(finalWorkerPath, 'require')}`
        : workerPathUrl

  const workerOptions = {
    eval: useEval,
    workerData: { sharedBufferView, workerPort, pnpLoaderPath },
    transferList: [workerPort, ...transferList],
  }

  // The guard has to load before any preload inherited through `NODE_OPTIONS` — which run first —
  // and before the worker module, so it leads the worker's own `NODE_OPTIONS`. Under PnP it cannot
  // lead that value: `register.cjs` sits inside the project's package archive, which the runtime can
  // only read once the PnP API has patched module resolution, so the PnP API's own require is
  // written in front of it and the guard follows. Requiring the API here is cheap: `pnpapi` resolves
  // to `.pnp.cjs` on the real file system, and the copy the project already inherited is the same
  // module, so the module cache answers one of the two. A worker that already inherits the guard
  // keeps its environment untouched, so a synckit worker inside a worker cannot accumulate one
  // preload flag per nesting level. The check scans the parsed value for the pair this code writes,
  // wherever it sits, because under PnP the pair follows the PnP require: anchored at the first
  // argument it would miss a nested worker's guard and prepend another at every level. A guard that
  // merely sits in this process's `execArgv` — the fallback below writes that — or that appears as
  // another flag's value does not count, and a hand-written `--require <guard>` only costs a
  // duplicate preload, which the module cache and the per-slice state absorb. It relies on
  // `NODE_OPTIONS` being fixed when the process starts, which is what makes the array parsed then
  // the value the environment below follows
  const inheritsGuard = NODE_OPTIONS.some(
    (argument, index) =>
      REQUIRE_FLAGS.has(argument) && NODE_OPTIONS[index + 1] === workerPreload,
  )

  // Under PnP the API require opens the worker's `NODE_OPTIONS`, and every other inherited preload
  // still comes after the guard
  const pnpPreload = pnpApiPath
    ? `${REQUIRE_ABBR_FLAG} ${JSON.stringify(pnpApiPath)} `
    : ''

  // On that path the guard is put into `execArgv` as well. `NODE_OPTIONS` is what the check decided
  // to trust, but a caller can clear the variable before creating a nested worker, and then nothing
  // would preload the guard — the load failure it exists to report would go unreported instead. A
  // duplicate preload is the worst case, which the module cache and the per-slice state absorb. The
  // pair added at the level above was dropped before the runner selection, so this stays one per level
  const guardExecArgv = [REQUIRE_ABBR_FLAG, workerPreload, ...finalExecArgv]

  let worker: Worker
  try {
    worker = new Worker(workerEntry, {
      ...workerOptions,
      env: inheritsGuard
        ? undefined
        : {
            ...process.env,
            NODE_OPTIONS: `${pnpPreload}${REQUIRE_ABBR_FLAG} ${JSON.stringify(workerPreload)}${
              process.env.NODE_OPTIONS ? ` ${process.env.NODE_OPTIONS}` : ''
            }`,
          },
      // the TypeScript runner's own `-r` entries stay; the guard is not one of them here
      execArgv: inheritsGuard ? guardExecArgv : finalExecArgv,
    })
  } catch (error) {
    // A runtime refuses an option it inherited once the environment is passed explicitly to a worker
    // (`--openssl-legacy-provider` on 18, `--title` on 24, the set varying by version) and there is
    // no programmatic list of the options a worker rejects, so retry with the inherited environment
    // and the guard back in `execArgv`, which every version takes. That path loses the preload
    // ordering: the guard loads after a preload inherited through `NODE_OPTIONS`, so a failure there
    // is reported by nothing. The call says so once, and the caller can bound the wait themselves —
    // with `SYNCKIT_TIMEOUT`, or a per-call timeout — which is the only bound this path has
    if ((error as { code?: string }).code !== 'ERR_WORKER_INVALID_EXEC_ARGV') {
      throw error
    }

    process.emitWarning(
      'synckit: this Node rejected the worker environment, so the failure guard loads after ' +
        'inherited `NODE_OPTIONS` preloads; a failure in one of those cannot be reported. Set ' +
        '`SYNCKIT_TIMEOUT` to bound the wait.',
      { code: FALLBACK_WARNING_CODE },
    )
    worker = new Worker(workerEntry, {
      ...workerOptions,
      execArgv: guardExecArgv,
    })
  }

  let nextID = 0

  // Cached so that later calls keep throwing the original failure instead of posting to a
  // worker which cannot answer
  let workerFailure: WorkerFailureMessage | undefined

  /**
   * Spends one pending notification, never taking the counter below zero.
   *
   * The check is not redundant: an unconditional decrement can take the counter negative, and a
   * negative counter makes every `Atomics.wait` return `'not-equal'` at once, so the caller spins
   * instead of sleeping and starves the worker until the deadline expires. Measured on Node 18.18
   * under the CI's load and timeout, restoring it took the `reliability` soak from three failures
   * in four runs to none in six.
   */
  const spendNotification = () => {
    if (Atomics.load(sharedBufferView, NOTIFY_INDEX) > 0) {
      Atomics.sub(sharedBufferView, NOTIFY_INDEX, 1)
    }
  }

  /**
   * Waits once for a notification and returns the message it announced, if any. A failure the
   * preload reported is thrown from here.
   *
   * The notification is spent only once its message is in hand. Spending it first would let a
   * notification whose message is not readable yet be spent on nothing: the next wait, seeing a zero
   * counter, would sleep past a message that never notifies again — measured with a real
   * `Atomics.wait`, where the call failed at its deadline although the response was queued.
   *
   * @param abortId - The request to abort when the wait itself fails.
   * @param remaining - Milliseconds left of the call's budget.
   */
  const waitForMessage = (
    abortId: number,
    remaining?: number,
  ): WorkerToMainMessage<R> | undefined => {
    const status = Atomics.wait(sharedBufferView, NOTIFY_INDEX, 0, remaining)

    if (!['ok', 'not-equal'].includes(status)) {
      abortRequest(mainPort, abortId)
      throw new Error('Internal error: Atomics.wait() failed: ' + status)
    }

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
    const result = receiveMessageOnPort(mainPort) as
      { message: WorkerFailureMessage | WorkerToMainMessage<R> } | undefined

    const msg = result?.message

    if (!msg) {
      // a notification can reach this thread just before the message it announces is readable; it
      // stays pending, and the caller re-reads the port at once instead of sleeping past it
      return
    }

    spendNotification()

    if ('workerFailure' in msg) {
      // a worker that never registered a handler, or that is gone, cannot serve later calls, so
      // its failure is cached; one that only reported a failure may well serve again
      if (msg.fatal) {
        workerFailure = msg
      }

      throw withProperties(msg.error, msg.properties)
    }

    return msg
  }

  const receiveMessageWithId = (
    expectedId: number,
    waitingTimeout?: number,
  ): WorkerToMainMessage<R> => {
    // One deadline for the whole call: the first wait gets the full budget and every later wait
    // only what is left of it, so a stream of outdated messages cannot push the total wait past
    // `waitingTimeout`.
    const deadline =
      waitingTimeout == null ? undefined : Date.now() + waitingTimeout

    // Never negative: a coarse or loaded clock can overshoot the deadline, and a negative timeout
    // is not a shorter wait. `0` means the deadline is due, so the wait returns `'timed-out'` and
    // the call fails now, while `undefined` is what waits indefinitely.
    let remaining =
      waitingTimeout == null ? undefined : Math.max(0, waitingTimeout)

    // A pending notification whose message is not readable yet is retried at once, because it is
    // still unspent; this bounds that retrying. `Atomics.wait` cannot time out while the counter is
    // non-zero, so a notification that never brings a message — a report whose every post failed on
    // a closed port — would otherwise spin for ever.
    let emptyReads = 0

    for (;;) {
      const msg = waitForMessage(expectedId, remaining)

      if (msg == null || msg.id < expectedId) {
        // an outdated or missing response: wait again with only the time this call has left, never
        // a negative remainder
        if (msg == null) {
          emptyReads = noteEmptyRead(
            sharedBufferView,
            emptyReads,
            deadline,
            remaining,
            mainPort,
            expectedId,
          )
        }

        remaining =
          deadline == null ? undefined : Math.max(0, deadline - Date.now())
        continue
      }

      if (expectedId !== msg.id) {
        throw new Error(
          `Internal error: Expected id ${expectedId} but got id ${msg.id}`,
        )
      }

      return msg
    }
  }

  const syncFn = (...args: Parameters<T>): R => {
    if (workerFailure) {
      throw withProperties(workerFailure.error, workerFailure.properties)
    }

    const id = nextID++

    const msg: MainToWorkerMessage<Parameters<T>> = { id, args }

    worker.postMessage(msg)

    const message = receiveMessageWithId(id, timeout)

    for (const { type, chunk, encoding } of message.stdio) {
      process[type].write(chunk, encoding)
    }

    // a message that carries an `error` key is a failure, whatever the reason is. Key presence is
    // the faithful test: a structured clone keeps an own key whose value is `undefined`, which is
    // itself a legitimate reason, and truthiness or `!== undefined` would swallow it
    if ('error' in message) {
      throw withProperties(message.error, message.properties)
    }

    return message.result
  }

  worker.unref()

  return syncFn
}

export const overrideStdio = (stdio: StdioChunk[]) => {
  // https://github.com/nodejs/node/blob/66556f53a7b36384bce305865c30ca43eaa0874b/lib/internal/worker/io.js#L369
  for (const type of ['stdout', 'stderr'] as const) {
    process[type]._writev = (chunks, callback) => {
      for (const {
        // type-coverage:ignore-next-line -- we can't control
        chunk,
        encoding,
      } of chunks) {
        stdio.push({
          type,
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- we can't control
          chunk,
          encoding,
        })
      }
      callback()
    }
  }
}
