import { compareVersion, hasFlag } from './common.js'
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

export const MTS_SUPPORTED_NODE_VERSION = '16'
export const LOADER_SUPPORTED_NODE_VERSION = '20'

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

export const NODE_VERSION = process.versions.node

export const NO_STRIP_TYPES = // >=
  compareVersion(NODE_VERSION, FEATURE_TYPESCRIPT_NODE_VERSION) >= 0
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

export const INT32_BYTES = 4
