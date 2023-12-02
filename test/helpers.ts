import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { MTS_SUPPORTED_NODE_VERSION } from 'synckit'

export const _dirname = path.dirname(fileURLToPath(import.meta.url))

export const nodeVersion = Number.parseFloat(process.versions.node)

export const tsUseEsmSupported =
  nodeVersion >= MTS_SUPPORTED_NODE_VERSION &&
  // ts-jest limitation
  nodeVersion < 20

export const testIf = (condition: boolean) => (condition ? it : it.skip)
