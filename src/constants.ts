import { compareNodeVersion, hasFlag } from './common.js'
import type { GlobalShim, ValueOf } from './types.js'

export const TsRunner = {
  // https://nodejs.org/docs/latest/api/typescript.html#type-stripping
  Node: 'node',
  // https://bun.sh/docs/typescript
  Bun: 'bun',
  // https://github.com/TypeStrong/ts-node
  TsNode: 'ts-node',
  // https://github.com/egoist/esbuild-register
  EsbuildRegister: 'esbuild-register',
  // https://github.com/folke/esbuild-runner
  EsbuildRunner: 'esbuild-runner',
  // https://github.com/oxc-project/oxc-node
  OXC: 'oxc',
  // https://github.com/swc-project/swc-node/tree/master/packages/register
  SWC: 'swc',
  // https://github.com/esbuild-kit/tsx
  TSX: 'tsx',
} as const

export type TsRunner = ValueOf<typeof TsRunner>

const {
  NODE_OPTIONS: NODE_OPTIONS_ = '',
  SYNCKIT_EXEC_ARGV = '',
  SYNCKIT_GLOBAL_SHIMS,
  SYNCKIT_TIMEOUT,
  SYNCKIT_TS_RUNNER,
} = process.env

// https://github.com/privatenumber/tsx/issues/354
export const TS_ESM_PARTIAL_SUPPORTED =
  // >=
  compareNodeVersion('16') >= 0 &&
  // <
  compareNodeVersion('18.19') < 0

// >=, `module.register` is required
export const MTS_SUPPORTED = compareNodeVersion('20.8') >= 0

// https://nodejs.org/api/module.html#moduleregisterspecifier-parenturl-options
export const MODULE_REGISTER_SUPPORTED =
  MTS_SUPPORTED ||
  // >=
  compareNodeVersion('18.19') >= 0

// https://nodejs.org/docs/latest-v22.x/api/typescript.html#type-stripping
export const STRIP_TYPES_NODE_VERSION = '22.6'

// https://nodejs.org/docs/latest-v23.x/api/typescript.html#modules-typescript
export const TRANSFORM_TYPES_NODE_VERSION = '22.7'

// https://nodejs.org/docs/latest-v22.x/api/process.html#processfeaturestypescript
export const FEATURE_TYPESCRIPT_NODE_VERSION = '22.10'

// https://nodejs.org/docs/latest-v23.x/api/typescript.html#type-stripping
export const DEFAULT_TYPES_NODE_VERSION = '23.6'

export const STRIP_TYPES_FLAG = '--experimental-strip-types'
export const TRANSFORM_TYPES_FLAG = '--experimental-transform-types'
export const NO_STRIP_TYPES_FLAG = '--no-experimental-strip-types'

export const NODE_OPTIONS = NODE_OPTIONS_.split(/\s+/)

export const NO_STRIP_TYPES = // >=
  compareNodeVersion(FEATURE_TYPESCRIPT_NODE_VERSION) >= 0
    ? process.features.typescript === false
    : hasFlag(NO_STRIP_TYPES_FLAG) &&
      !hasFlag(STRIP_TYPES_FLAG) &&
      !hasFlag(TRANSFORM_TYPES_FLAG)

export const DEFAULT_TIMEOUT = SYNCKIT_TIMEOUT ? +SYNCKIT_TIMEOUT : undefined

export const DEFAULT_EXEC_ARGV = SYNCKIT_EXEC_ARGV.split(',')

export const DEFAULT_TS_RUNNER = SYNCKIT_TS_RUNNER as TsRunner | undefined

export const DEFAULT_GLOBAL_SHIMS = ['1', 'true'].includes(
  SYNCKIT_GLOBAL_SHIMS!,
)

export const DEFAULT_GLOBAL_SHIMS_PRESET: GlobalShim[] = [
  {
    moduleName: 'node-fetch',
    globalName: 'fetch',
  },
  {
    moduleName: 'node:perf_hooks',
    globalName: 'performance',
    named: 'performance',
  },
]

export const IMPORT_FLAG = '--import'

export const REQUIRE_FLAG = '--require'

export const REQUIRE_ABBR_FLAG = '-r'

export const REQUIRE_FLAGS = new Set([REQUIRE_FLAG, REQUIRE_ABBR_FLAG])

export const LOADER_FLAG = '--loader'

export const EXPERIMENTAL_LOADER_FLAG = '--experimental-loader'

export const LOADER_FLAGS = new Set([LOADER_FLAG, EXPERIMENTAL_LOADER_FLAG])

// >=
export const IMPORT_FLAG_SUPPORTED = compareNodeVersion('20.6') >= 0

export const INT32_BYTES = 4
