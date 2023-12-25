import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { MTS_SUPPORTED_NODE_VERSION } from 'synckit'

export const _dirname = path.dirname(fileURLToPath(import.meta.url))

export const nodeVersion = Number.parseFloat(process.versions.node)

export const tsUseEsmSupported =
  // https://github.com/privatenumber/tsx/issues/354
  // eslint-disable-next-line @typescript-eslint/no-magic-numbers
  nodeVersion >= MTS_SUPPORTED_NODE_VERSION && nodeVersion <= 18.18

export const testIf = (condition: boolean) => (condition ? it : it.skip)
