import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const _dirname = path.dirname(fileURLToPath(import.meta.url))
