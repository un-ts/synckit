import { getFlag } from '../shared.cjs'

export {
  compareNodeVersion,
  compareVersion,
  NODE_VERSION,
  parseVersion,
} from '../shared.cjs'

// A flag is set when the runtime was given it — `execArgv` or `NODE_OPTIONS` — in either the
// `--flag=value` or `--flag value` form. A flag after the script path is a script argument, which
// Node does not apply, so it is not counted; `getFlag` also tells a flag without a value from an
// absent one.
export const hasFlag = (flag: string) => getFlag(flag) !== undefined
