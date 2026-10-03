import { createHash } from 'node:crypto'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  type MessagePort,
  MessageChannel,
  Worker,
  isMainThread,
  receiveMessageOnPort,
  // type-coverage:ignore-next-line -- we can't control
  workerData,
} from 'node:worker_threads'

import { tryExtensions, findUp, cjsRequire, isPkgAvailable } from '@pkgr/core'

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
  INT32_BYTES,
  LOADER_FLAG,
  LOADER_FLAGS,
  MTS_SUPPORTED,
  NO_STRIP_TYPES,
  NO_STRIP_TYPES_FLAG,
  NODE_OPTIONS,
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
  WorkerData,
  WorkerLoadErrorMessage,
  WorkerToMainMessage,
} from './types.js'

export const isFile = (path: string) => {
  try {
    return !!fs.statSync(path, { throwIfNoEntry: false })?.isFile()
  } catch {
    /* istanbul ignore next */
    return false
  }
}

export const dataUrl = (code: string) =>
  new URL(`data:text/javascript,${encodeURIComponent(code)}`)

/**
 * The shared state the main thread and a worker agree on: a notification byte and the load
 * guard's state (idle, armed, or the module finished loading). Keeping the guard state here
 * is what makes it idempotent and lets it disarm itself without any module-level or global
 * state — the preload (synckit's CommonJS build) and the worker module's own import of
 * synckit are two module instances that only share what travels in `workerData`.
 */
const TS_SOURCE = /\.[cm]?ts$/

const NOTIFY_INDEX = 0
const STATE_INDEX = 1
const SLICE_INTS = 2
const STATE_ARMED = 1
const STATE_LOADED = 2
const INITIAL_SLICES = 64

let sharedBuffer: SharedArrayBuffer | undefined
let sharedSlices = 0
let nextSlice = 0

/**
 * Reserves this worker's slice of the process-wide shared buffer and returns a view of it.
 *
 * One buffer per process, as in #154, so the allocation stays off the per-worker cost; one
 * slice per worker because a worker reports its own load failure before any request exists,
 * and a single shared word would let an unrelated `syncFn` call consume that notification
 * and then hang forever.
 *
 * Growing allocates a new, larger buffer; workers already running keep their views on the old
 * one.
 *
 * @internal
 */
export const createSharedBufferView = () => {
  const slice = nextSlice++
  const needed = (slice + 1) * SLICE_INTS

  if (needed > sharedSlices || !sharedBuffer) {
    sharedSlices = Math.max(needed, sharedSlices * 2, INITIAL_SLICES)
    sharedBuffer = new SharedArrayBuffer(sharedSlices * INT32_BYTES)
  }

  return new Int32Array(
    sharedBuffer,
    slice * SLICE_INTS * INT32_BYTES,
    SLICE_INTS,
  )
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

  let resolvedPnpLoaderPath: string | undefined

  /* istanbul ignore if -- https://github.com/facebook/jest/issues/5274 */
  if (process.versions.pnp) {
    let pnpApiPath: string | undefined
    try {
      /** @see https://github.com/facebook/jest/issues/9543 */
      pnpApiPath = cjsRequire.resolve('pnpapi')
    } catch {}
    if (
      pnpApiPath &&
      !NODE_OPTIONS.some(
        (option, index) =>
          REQUIRE_FLAGS.has(option) &&
          pnpApiPath === cjsRequire.resolve(NODE_OPTIONS[index + 1]),
      ) &&
      !execArgv.includes(pnpApiPath)
    ) {
      execArgv = [REQUIRE_ABBR_FLAG, pnpApiPath, ...execArgv]
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
        } '${
          path.isAbsolute(moduleName)
            ? String(pathToFileURL(moduleName))
            : moduleName
        }'`
      : `${
          globalName
            ? 'const ' + (named?.trim() ? `{${named}}` : globalName) + '='
            : ''
        }require('${moduleName
          // eslint-disable-next-line unicorn-x/prefer-string-replace-all -- compatibility
          .replace(/\\/g, '\\\\')}')`

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

let globalsCache: Map<string, [content: string, filepath?: string]> | undefined

let tmpdir: string

const _dirname =
  typeof __dirname === 'undefined'
    ? path.dirname(fileURLToPath(import.meta.url))
    : /* istanbul ignore next */ __dirname

// A `require` bound to this module, so it resolves like a consumer of synckit would, wherever
// the package was installed.
const synckitRequire = createRequire(
  typeof __filename === 'undefined'
    ? import.meta.url
    : /* istanbul ignore next */ __filename,
)

export const generateGlobals = (
  workerPath: string,
  globalShims: GlobalShim[],
  type: 'import' | 'require' = 'import',
) => {
  if (globalShims.length === 0) {
    return ''
  }

  globalsCache ??= new Map()

  const cached = globalsCache.get(workerPath)

  if (cached) {
    const [content, filepath] = cached

    if (
      (type === 'require' && !filepath) ||
      (type === 'import' && filepath && isFile(filepath))
    ) {
      return content
    }
  }

  const globals = _generateGlobals(globalShims, type)

  let content = globals
  let filepath: string | undefined

  if (type === 'import') {
    if (!tmpdir) {
      tmpdir = path.resolve(findUp(_dirname), '../node_modules/.synckit')
    }
    fs.mkdirSync(tmpdir, { recursive: true })
    filepath = path.resolve(tmpdir, md5Hash(workerPath) + '.mjs')
    content = encodeImportModule(filepath)
    fs.writeFileSync(filepath, globals)
  }

  globalsCache.set(workerPath, [content, filepath])

  return content
}

// MessagePort doesn't copy the properties of Error objects. We still want
// error objects to have extra properties such as "warnings" so implement the
// property copying manually.
export function extractProperties<T extends object>(object: T): T
export function extractProperties<T>(object?: T): T | undefined

/**
 * Creates a shallow copy of the enumerable properties from the provided object.
 *
 * @param object - An optional object whose properties are to be extracted.
 * @returns A new object containing the enumerable properties of the input, or
 *   undefined if no valid object is provided.
 */
export function extractProperties<T>(object?: T) {
  if (object && typeof object === 'object') {
    const properties = {} as T
    for (const key in object) {
      properties[key as keyof T] = object[key]
    }
    return properties
  }
}

/**
 * Reports a failure to load the worker module, and wakes the main thread.
 *
 * It is installed from synckit's CommonJS build, which `startWorkerThread` preloads into the
 * worker with `-r`, so it is in place before the worker module and before any `--require` /
 * `--import` hook that module needs. `runAsWorker` removes it once the module registered, so
 * it never changes the semantics of errors raised later.
 *
 * The main thread is blocked in `Atomics.wait()` and cannot observe the worker's `error`
 * event, so this notification is the only way out. The error's own properties are copied
 * because MessagePort does not clone them, and the shared buffer is notified whatever
 * happens — even when the error cannot be serialized at all.
 *
 * @internal
 */
export const installWorkerLoadGuard = (data?: Partial<WorkerData>) => {
  // a loader thread re-runs the `-r` preload with `workerData` null, and there is nothing to
  // guard there
  const { sharedBufferView, workerPort } = data ?? {}
  if (!sharedBufferView || !workerPort) {
    return
  }

  // the preload and the worker module's own import of synckit both get here, and only one
  // guard must be armed
  if (
    Atomics.compareExchange(sharedBufferView, STATE_INDEX, 0, STATE_ARMED) !== 0
  ) {
    return
  }

  const guard = (error: unknown) => {
    // disarm: from here on this worker behaves exactly as an unguarded one
    process.off('uncaughtException', guard)
    process.off('unhandledRejection', guard)

    if (Atomics.load(sharedBufferView, STATE_INDEX) === STATE_LOADED) {
      // the module loaded, so this is a runtime failure, not a load failure
      throw error
    }

    try {
      workerPort.postMessage({
        loadError: true,
        error: error ?? new Error('Worker module failed to load'),
        properties: extractProperties(error as object),
      })
    } catch {
      // the error is not cloneable; report something that always is
      workerPort.postMessage({
        loadError: true,
        error: new Error('Worker module failed to load'),
      })
    } finally {
      Atomics.add(sharedBufferView, NOTIFY_INDEX, 1)
      Atomics.notify(sharedBufferView, NOTIFY_INDEX)
    }
  }

  process.on('uncaughtException', guard)
  process.on('unhandledRejection', guard)
}

/** Marks the worker module as loaded, so the guard stops reporting failures.
 *
 * @internal
 */
export const markWorkerLoaded = (sharedBufferView: Int32Array) => {
  Atomics.store(sharedBufferView, STATE_INDEX, STATE_LOADED)
}

// A worker preloads this module with `-r <synckit>`, before the worker module and before any
// `--require` / `--import` hook it needs, so arming the guard here is what reports a failure
// to load that module instead of leaving the main thread blocked in `Atomics.wait()`.
/* istanbul ignore next -- only reached inside a worker, whose copy is not instrumented */
// type-coverage:ignore-next-line -- we cannot control
if (!isMainThread) {
  installWorkerLoadGuard(workerData as Partial<WorkerData>)
}

let workerPreload: string | null | undefined

/**
 * Absolute path of the module preloaded into every worker to arm the load guard.
 *
 * `require.resolve(synckit)` decides it, so the path follows whatever the package declares —
 * a build layout change or an `exports` rewrite cannot break it. A test runner that maps the
 * package to its source (this repository's jest config does) resolves to a `.ts` file
 * instead, which `-r` can only load behind a TypeScript loader; the CommonJS entry declared by
 * the manifest is used then. When neither is a real file — a bundler inlined synckit, or the
 * package was not built — the guard is not armed and a failing worker behaves as it did before.
 */
const getWorkerPreload = () => {
  if (workerPreload === undefined) {
    const candidates: Array<string | undefined> = []

    try {
      candidates.push(synckitRequire.resolve('synckit'))
    } catch {
      // not resolvable as a package
    }

    try {
      const { main } = JSON.parse(
        fs.readFileSync(path.resolve(_dirname, '../package.json'), 'utf8'),
      ) as { main?: string }
      if (main) {
        candidates.push(path.resolve(_dirname, '..', main))
      }
    } catch {
      // no manifest next to this module
    }

    workerPreload =
      candidates.find(
        candidate =>
          candidate != null && !TS_SOURCE.test(candidate) && isFile(candidate),
      ) ?? null
  }

  return workerPreload ?? undefined
}

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

  const {
    isTs,
    ext,
    jsUseEsm,
    tsUseEsm,
    tsRunner: finalTsRunner,
    workerPath: finalWorkerPath,
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

  const finalGlobalShims = (
    globalShims === true
      ? DEFAULT_GLOBAL_SHIMS_PRESET
      : Array.isArray(globalShims)
        ? globalShims
        : []
  ).filter(({ moduleName }) => isPkgAvailable(moduleName))

  const sharedBufferView = createSharedBufferView()

  const useGlobals = finalGlobalShims.length > 0

  const useEval = isTs ? !tsUseEsm : !jsUseEsm && useGlobals

  const preload = getWorkerPreload()

  const worker = new Worker(
    (jsUseEsm && useGlobals) || (tsUseEsm && finalTsRunner === TsRunner.TsNode)
      ? dataUrl(
          `${generateGlobals(
            finalWorkerPath,
            finalGlobalShims,
          )};import '${String(workerPathUrl)}'`,
        )
      : useEval
        ? `${generateGlobals(
            finalWorkerPath,
            finalGlobalShims,
            'require',
          )};${encodeImportModule(finalWorkerPath, 'require')}`
        : workerPathUrl,
    {
      eval: useEval,
      workerData: { sharedBufferView, workerPort, pnpLoaderPath },
      transferList: [workerPort, ...transferList],
      execArgv: preload
        ? [REQUIRE_ABBR_FLAG, preload, ...finalExecArgv]
        : finalExecArgv,
    },
  )

  let nextID = 0

  // Cached so that later calls keep throwing the original load error instead of
  // posting to a worker which never managed to register a handler.
  let loadError: { error: object; properties?: unknown } | undefined

  const receiveMessageWithId = (
    port: MessagePort,
    expectedId: number,
    waitingTimeout?: number,
  ): WorkerToMainMessage<R> => {
    const start = Date.now()
    const status = Atomics.wait(sharedBufferView, 0, 0, waitingTimeout)
    Atomics.store(sharedBufferView, 0, 0)

    if (!['ok', 'not-equal'].includes(status)) {
      const abortMsg: MainToWorkerCommandMessage = {
        id: expectedId,
        cmd: 'abort',
      }
      port.postMessage(abortMsg)
      throw new Error('Internal error: Atomics.wait() failed: ' + status)
    }

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
    const result = receiveMessageOnPort(mainPort) as
      | { message: WorkerLoadErrorMessage | WorkerToMainMessage<R> }
      | undefined

    const msg = result?.message

    if (msg && 'loadError' in msg) {
      // the guard always reports a normalized `Error`
      const error = msg.error as object
      loadError = { error, properties: msg.properties }
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw Object.assign(error, msg.properties)
    }

    if (msg?.id == null || msg.id < expectedId) {
      const waitingTime = Date.now() - start
      return receiveMessageWithId(
        port,
        expectedId,
        waitingTimeout ? waitingTimeout - waitingTime : undefined,
      )
    }

    const { id, ...message } = msg

    if (expectedId !== id) {
      throw new Error(
        `Internal error: Expected id ${expectedId} but got id ${id}`,
      )
    }

    return { id, ...message }
  }

  const syncFn = (...args: Parameters<T>): R => {
    if (loadError) {
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw Object.assign(loadError.error, loadError.properties)
    }

    const id = nextID++

    const msg: MainToWorkerMessage<Parameters<T>> = { id, args }

    worker.postMessage(msg)

    const { result, error, properties, stdio } = receiveMessageWithId(
      mainPort,
      id,
      timeout,
    )

    for (const { type, chunk, encoding } of stdio) {
      process[type].write(chunk, encoding)
    }

    if (error) {
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw Object.assign(error, properties)
    }

    return result!
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
