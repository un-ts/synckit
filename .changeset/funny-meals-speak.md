---
"synckit": patch
---

feat: add new `globalShims` option, what means you can env `SYNCKIT_GLOBAL_SHIMS=1` to enable auto polyfilling for some modules, for example: `fetch` from `node-fetch`, `performance` from `node:perf_hooks`.

You can also pass a custom `globalShims` option as `GlobalShim` `Array` to custom your own shims:

````ts
export interface GlobalShim {
  moduleName: string
  /**
   * `undefined` means side effect only
   */
  globalName?: string
  /**
   * 1. `undefined` or empty string means `default`, for example:
   * ```js
   * import globalName from 'module-name'
   * ```
   *
   * 2. `null` means namespaced, for example:
   * ```js
   * import * as globalName from 'module-name'
   * ```
   *
   */
  named?: string | null
  /**
   * If not `false`, the shim will only be applied when the original `globalName` unavailable,
   * for example you may only want polyfill `globalThis.fetch` when it's unavailable natively:
   * ```js
   * import fetch from 'node-fetch'
   *
   * if (!globalThis.fetch) {
   *   globalThis.fetch = fetch
   * }
   * ```
   */
  conditional?: boolean
}
````

You can aslo reuse the exported `DEFAULT_GLOBAL_SHIMS_PRESET` for extanding:

```js
import { DEFAULT_GLOBAL_SHIMS_PRESET, createSyncFn } from 'synckit'

const syncFn = createSyncFn(require.resolve('./worker'), {
  globalShims: [
    ...DEFAULT_GLOBAL_SHIMS_PRESET,
    // your own shim here
  ]
})
```
