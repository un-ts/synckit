import { NODE_OPTIONS } from '../shared.cjs'

export {
  compareNodeVersion,
  compareVersion,
  NODE_VERSION,
  parseVersion,
} from '../shared.cjs'

export const hasFlag = (flag: string) =>
  NODE_OPTIONS.includes(flag) || process.argv.includes(flag)
