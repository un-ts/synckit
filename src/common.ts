import { getFlag } from '../shared.cjs'

export {
  compareNodeVersion,
  compareVersion,
  NODE_VERSION,
  parseVersion,
} from '../shared.cjs'

// A flag is set when any source carries it, whether its value is joined with `=` or given as the
// next argument; `getFlag` tells a flag without a value from one that is absent.
export const hasFlag = (flag: string) => getFlag(flag) !== undefined
