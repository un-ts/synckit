# synckit

## 0.11.7

### Patch Changes

- [#217](https://github.com/un-ts/synckit/pull/217) [`2a3f936`](https://github.com/un-ts/synckit/commit/2a3f9361c37110f7f096a2f2ffb690dd3432a755) Thanks [@fisker](https://github.com/fisker) and [@JounQin](https://github.com/JounQin)! - fix: unexpected null pointer exception due to race condition

## 0.11.6

### Patch Changes

- [#240](https://github.com/un-ts/synckit/pull/240) [`e0caff5`](https://github.com/un-ts/synckit/commit/e0caff54a9865ee49e53e610ee1a1bc80ca1279c) Thanks [@JounQin](https://github.com/JounQin)! - refactor: target ES2020 to drop `tslib` dependency

## 0.11.5

### Patch Changes

- [#235](https://github.com/un-ts/synckit/pull/235) [`abdb67a`](https://github.com/un-ts/synckit/commit/abdb67a11f67151fd39ac646b4ea11b325e079ac) Thanks [@JounQin](https://github.com/JounQin)! - fix: use `tsdown` to bundle `cjs` outputs

## 0.11.4

### Patch Changes

- [#232](https://github.com/un-ts/synckit/pull/232) [`18e6cd4`](https://github.com/un-ts/synckit/commit/18e6cd477919310d5f230bc0c3b5e9cb89183405) Thanks [@JounQin](https://github.com/JounQin)! - fix: remove buggy `module-sync` entry

## 0.11.3

### Patch Changes

- [#228](https://github.com/un-ts/synckit/pull/228) [`cc7c724`](https://github.com/un-ts/synckit/commit/cc7c724e0a3ef1fe6fa425767f50f7206f130ec4) Thanks [@JounQin](https://github.com/JounQin)! - fix: legacy top level `types` entry should prefer `.d.cts`

## 0.11.2

### Patch Changes

- [#226](https://github.com/un-ts/synckit/pull/226) [`133408d`](https://github.com/un-ts/synckit/commit/133408db2d42ddd4e6c9b1c902700949c27117a2) Thanks [@JounQin](https://github.com/JounQin)! - fix: `.cts` should never be treated as esm

## 0.11.1

### Patch Changes

- [#224](https://github.com/un-ts/synckit/pull/224) [`0966d2a`](https://github.com/un-ts/synckit/commit/0966d2aa2f9a8d4b2c8692edf6b2e2d150f8b9ed) Thanks [@JounQin](https://github.com/JounQin)! - fix: add missing `MessageChannel` from `node:worker_threads` for Node 14 compatibility

## 0.11.0

### Minor Changes

- [#222](https://github.com/un-ts/synckit/pull/222) [`59f7432`](https://github.com/un-ts/synckit/commit/59f743294c1843b1c4946fa08df42fa785975ffc) Thanks [@JounQin](https://github.com/JounQin)! - feat: add `oxc` ts runner support, correct `swc` ts runner with `--import` flag support

### Patch Changes

- [#222](https://github.com/un-ts/synckit/pull/222) [`59f7432`](https://github.com/un-ts/synckit/commit/59f743294c1843b1c4946fa08df42fa785975ffc) Thanks [@JounQin](https://github.com/JounQin)! - fix: `.cjs` should never be treated as ESM

- [#219](https://github.com/un-ts/synckit/pull/219) [`79fa3a2`](https://github.com/un-ts/synckit/commit/79fa3a2386666be6379244414066888fbebeefac) Thanks [@JounQin](https://github.com/JounQin)! - refactor: split into chunk files, add `module-sync` entry

- [#222](https://github.com/un-ts/synckit/pull/222) [`59f7432`](https://github.com/un-ts/synckit/commit/59f743294c1843b1c4946fa08df42fa785975ffc) Thanks [@JounQin](https://github.com/JounQin)! - fix: only consider `process.features.typescript` when `--no-experimental-strip-types` flag enabled

## 0.10.3

### Patch Changes

- [#214](https://github.com/un-ts/synckit/pull/214) [`386bfb9`](https://github.com/un-ts/synckit/commit/386bfb91434e4947785085720ab66b24f7679639) Thanks [@fisker](https://github.com/fisker)! - chore: improve performance on first run

## 0.10.2

### Minor Changes

- [#206](https://github.com/un-ts/synckit/pull/206) [`011e9c0`](https://github.com/un-ts/synckit/commit/011e9c0e3fa12493068a009f6359904aeb3dced8) Thanks [@JounQin](https://github.com/JounQin)! - refactor: simplify types, any function should be accepted

- [#210](https://github.com/un-ts/synckit/pull/210) [`888302c`](https://github.com/un-ts/synckit/commit/888302c6f30d83c76a0f924e07e7867695a6ca3e) Thanks [@JounQin](https://github.com/JounQin)! - feat: add new `bun` ts runner

- [#211](https://github.com/un-ts/synckit/pull/211) [`19f9a78`](https://github.com/un-ts/synckit/commit/19f9a78fcc3596eceb123b6b65bd3c32f01d0d34) Thanks [@JounQin](https://github.com/JounQin)! - feat: support `node` runner by default for Node 22.6+

- [#213](https://github.com/un-ts/synckit/pull/213) [`0d168d7`](https://github.com/un-ts/synckit/commit/0d168d729d3f67c64b655718c24752e580559bec) Thanks [@JounQin](https://github.com/JounQin)! - feat: support `stdio` overriding in worker, what means `stdio` will be streamed in correct order now

- [#208](https://github.com/un-ts/synckit/pull/208) [`d3da4c3`](https://github.com/un-ts/synckit/commit/d3da4c3542483022248ff191d43d4f1de3136a86) Thanks [@JounQin](https://github.com/JounQin)! - feat: support file url worker path

### Patch Changes

- [#209](https://github.com/un-ts/synckit/pull/209) [`61f2ff2`](https://github.com/un-ts/synckit/commit/61f2ff29186a12e624697fc5898cdee792f9361b) Thanks [@JounQin](https://github.com/JounQin)! - fix: incorrect commonjs types

## 0.10.1

### Patch Changes

- [#204](https://github.com/un-ts/synckit/pull/204) [`e13a68a`](https://github.com/un-ts/synckit/commit/e13a68aed92b90099741bab712c695c3bccbfcff) Thanks [@nwidynski](https://github.com/nwidynski)! - fix: add support for type transformations to node runner, clarify correct Node versions support

## 0.10.0

### Minor Changes

- [#199](https://github.com/un-ts/synckit/pull/199) [`7a5f1bd`](https://github.com/un-ts/synckit/commit/7a5f1bd22d5535a896457b4bcc8028f0d15e3cde) Thanks [@nwidynski](https://github.com/nwidynski)! - feat: add support for `--experimental-strip-types`

  Introducing the `node` runner, which will replace `ts-node` as the new default:

  - when running on Node 22 with the `--experimental-strip-types`
    flag enabled via `NODE_OPTIONS` env or cli args
  - or when running on Node 23+ without `--no-experimental-strip-types`
    flag enabled via `NODE_OPTIONS` env or cli args

  An error will be thrown when attempting to run with `node` on unsupported versions (<22).
  On these versions, the default runner remains `ts-node` when available.

## 0.9.2

### Patch Changes

- [#184](https://github.com/un-ts/synckit/pull/184) [`30d28ae`](https://github.com/un-ts/synckit/commit/30d28aefd5a5cdc86f82ee9f1d53853909814fc5) Thanks [@jedlikowski](https://github.com/jedlikowski)! - fix: handle outdated message in channel queue

## 0.9.1

### Patch Changes

- [#175](https://github.com/un-ts/synckit/pull/175) [`e99bf89`](https://github.com/un-ts/synckit/commit/e99bf89a28e64d45643a819d1f74f038699c480e) Thanks [@fmal](https://github.com/fmal)! - fix: support yarn pnp with node 20

## 0.9.0

### Minor Changes

- [#154](https://github.com/un-ts/synckit/pull/154) [`2541a1e`](https://github.com/un-ts/synckit/commit/2541a1e9b3d0e8f01f29f78ac53cb835936f6a30) Thanks [@onigoetz](https://github.com/onigoetz)! - feat!: use a single SharedArrayBuffer, remove useless `bufferSize` option

### Patch Changes

- [#156](https://github.com/un-ts/synckit/pull/156) [`be4648c`](https://github.com/un-ts/synckit/commit/be4648c45a698aee1be8e267b78542b13c8596aa) Thanks [@JounQin](https://github.com/JounQin)! - refactor: lazy initialize caches

## 0.8.8

### Patch Changes

- [#148](https://github.com/un-ts/synckit/pull/148) [`7b6a0eb`](https://github.com/un-ts/synckit/commit/7b6a0eb2c7e1f4482c72dc89e0f7474cd1bcc6d9) Thanks [@JounQin](https://github.com/JounQin)! - feat: migrate `@pkgr/utils` to lite `@pkgr/core` - This will make the whole package much more smaller

## 0.8.7

### Patch Changes

- [#145](https://github.com/un-ts/synckit/pull/145) [`b2affa0`](https://github.com/un-ts/synckit/commit/b2affa0e639bcdf252b7115402f22765aabedf3c) Thanks [@JounQin](https://github.com/JounQin)! - feat: add new `globalShims` option, what means you can env `SYNCKIT_GLOBAL_SHIMS=1` to enable auto polyfilling for some modules, for example: `fetch` from `node-fetch`, `performance` from `node:perf_hooks`.

  You can also pass a custom `globalShims` option as `GlobalShim` `Array` to custom your own shims:

  ````ts
  export interface GlobalShim {
    moduleName: string
    /** `undefined` means side effect only */
    globalName?: string
    /**
     * 1. `undefined` or empty string means `default`, for example:
     *
     * ```js
     * import globalName from 'module-name'
     * ```
     *
     * 2. `null` means namespaced, for example:
     *
     * ```js
     * import * as globalName from 'module-name'
     * ```
     */
    named?: string | null
    /**
     * If not `false`, the shim will only be applied when the original
     * `globalName` unavailable, for example you may only want polyfill
     * `globalThis.fetch` when it's unavailable natively:
     *
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
    ],
  })
  ```

## 0.8.6

### Patch Changes

- [#141](https://github.com/un-ts/synckit/pull/141) [`608c9d9`](https://github.com/un-ts/synckit/commit/608c9d9f9f98acfc1ff681706034bddc5bebba98) Thanks [@JounQin](https://github.com/JounQin)! - fix: only fallback to `ts-node` when it's available - close #128

- [#142](https://github.com/un-ts/synckit/pull/142) [`097e5cd`](https://github.com/un-ts/synckit/commit/097e5cd47a132b895f1f3d476197f909a364a9ec) Thanks [@JounQin](https://github.com/JounQin)! - feat: add custom transferList support - close #131

## 0.8.5

### Patch Changes

- [#126](https://github.com/un-ts/synckit/pull/126) [`758aaf1`](https://github.com/un-ts/synckit/commit/758aaf13f3a27f050269fb46116b5123fda1bd71) Thanks [@krossekrabbe](https://github.com/krossekrabbe)! - fix: pnp loader path on Windows

## 0.8.4

### Patch Changes

- [#109](https://github.com/un-ts/synckit/pull/109) [`b61087f`](https://github.com/un-ts/synckit/commit/b61087f02d9745375b85ed719126399d75b6be28) Thanks [@JounQin](https://github.com/JounQin)! - fix: incorrect `extractProperties` typings for known object

## 0.8.3

### Patch Changes

- [#106](https://github.com/un-ts/synckit/pull/106) [`9f27ff9`](https://github.com/un-ts/synckit/commit/9f27ff9b10c802cd670af97d660387ec9a9f4333) Thanks [@JounQin](https://github.com/JounQin)! - feat: add `swc` (`@swc-node/register`) support out of box

- [#103](https://github.com/un-ts/synckit/pull/103) [`b1308ac`](https://github.com/un-ts/synckit/commit/b1308accc392370fcac131c3d4d1a862c0c9170f) Thanks [@noahnu](https://github.com/noahnu)! - fix: pass yarn PnP experimental loader to worker if it exists

## 0.8.2

### Patch Changes

- [#98](https://github.com/un-ts/synckit/pull/98) [`4fe6aef`](https://github.com/un-ts/synckit/commit/4fe6aef243872ef5a1e05a72785f5f21d6736a41) Thanks [@noahnu](https://github.com/noahnu)! - feat: support yarn PnP out of box, propagate PnP runtime

- [#97](https://github.com/un-ts/synckit/pull/97) [`d1bed37`](https://github.com/un-ts/synckit/commit/d1bed37310edf4e4b92f57402e4f950cf4ff01a8) Thanks [@noahnu](https://github.com/noahnu)! - fix: typo of `SYNCKIT_EXEC_ARGV` environment variable

- [#101](https://github.com/un-ts/synckit/pull/101) [`34e44ae`](https://github.com/un-ts/synckit/commit/34e44ae42699dc3261affe8ad8e98a25a6134879) Thanks [@JounQin](https://github.com/JounQin)! - feat: propagate sync errors from worker

## 0.8.1

### Patch Changes

- [#92](https://github.com/un-ts/synckit/pull/92) [`396e964`](https://github.com/un-ts/synckit/commit/396e964549a1c7ede9faae07ab1b3165cd1bffce) Thanks [@JounQin](https://github.com/JounQin)! - fix: better compatibility on Node 14

## 0.8.0

### Minor Changes

- [#90](https://github.com/un-ts/synckit/pull/90) [`ffcf174`](https://github.com/un-ts/synckit/commit/ffcf174aae7f735f3706c11673cf40d79c6cdc16) Thanks [@JounQin](https://github.com/JounQin)! - build!: drop Node 12 support, remove testing on Node 14

- [#90](https://github.com/un-ts/synckit/pull/90) [`ffcf174`](https://github.com/un-ts/synckit/commit/ffcf174aae7f735f3706c11673cf40d79c6cdc16) Thanks [@JounQin](https://github.com/JounQin)! - feat: support more ts runners for TypeScript files

  - https://github.com/TypeStrong/ts-node
  - https://github.com/egoist/esbuild-register
  - https://github.com/folke/esbuild-runner
  - https://github.com/esbuild-kit/tsx

  Feel free to PR to add more runner support like [`swc`](https://github.com/swc-project/swc) if you want

## 0.7.3

### Patch Changes

- [#88](https://github.com/un-ts/synckit/pull/88) [`f9d0c3e`](https://github.com/un-ts/synckit/commit/f9d0c3e26f10a64c683bdb1117c5c1453b0036b4) Thanks [@JounQin](https://github.com/JounQin)! - feat: support map `cjs` to `cts`, `mjs` to `mts` automatically

## 0.7.2

### Patch Changes

- [`1101ede`](https://github.com/un-ts/synckit/commit/1101ede3fbc02df1561c9f84a183b3dbd8f8e7cb) Thanks [@JounQin](https://github.com/JounQin)! - chore: add donate and funding fields, update node engine field

## 0.7.1

### Patch Changes

- [`f098d29`](https://github.com/un-ts/synckit/commit/f098d2970b4aadd0a5687baaeeaec3d9b6697f30) Thanks [@JounQin](https://github.com/JounQin)! - fix: known Windows issues

- [`c53d9dc`](https://github.com/un-ts/synckit/commit/c53d9dc47e174bbf3e5c35b07d40194dda6173e9) Thanks [@JounQin](https://github.com/JounQin)! - feat: use workerPath as URL for Windows

  related mdx-js/eslint-mdx#389

## 0.7.0

### Minor Changes

- [#78](https://github.com/un-ts/synckit/pull/78) [`fd85ccd`](https://github.com/un-ts/synckit/commit/fd85ccd41f012f677619441694c3044f0b70c653) Thanks [@JounQin](https://github.com/JounQin)! - feat: support js as ts, ts as esm, etc

## 0.6.2

### Patch Changes

- [#76](https://github.com/un-ts/synckit/pull/76) [`e7393f1`](https://github.com/un-ts/synckit/commit/e7393f19b84e2b3ffdac7b48c7a1442e7cbabaf4) Thanks [@JounQin](https://github.com/JounQin)! - chore: export extractProperties

## 0.6.1

### Patch Changes

- [`da19076`](https://github.com/un-ts/synckit/commit/da1907659806b31b49a6e9c73ae07b160bb02ff9) Thanks [@JounQin](https://github.com/JounQin)! - fix: extract and apply error properties

## 0.6.0

### Minor Changes

- [`18106a5`](https://github.com/un-ts/synckit/commit/18106a511c9dfc21a9ae19c70ab19fb3b71fcbf5) Thanks [@JounQin](https://github.com/JounQin)! - feat: add custom `execArgv` support

  close #55

## 0.5.0

### Minor Changes

- [#47](https://github.com/un-ts/synckit/pull/47) [`a362982`](https://github.com/un-ts/synckit/commit/a362982eac4083ff3d00b4f6a9d4f4183dd2418e) Thanks [@JounQin](https://github.com/JounQin)! - feat: drop child_process

## 0.4.0

### Minor Changes

- [#45](https://github.com/un-ts/synckit/pull/45) [`f38de5f`](https://github.com/un-ts/synckit/commit/f38de5fe5dfc8e4a8871d3d55e7a4d9bdc3a5d05) Thanks [@JounQin](https://github.com/JounQin)! - feat: use native esm

## 0.3.4

### Patch Changes

- [#39](https://github.com/un-ts/synckit/pull/39) [`0698572`](https://github.com/un-ts/synckit/commit/0698572d048e38d9c1e5de233c07e89a7ca01eca) Thanks [@JounQin](https://github.com/JounQin)! - fix: test whether `receiveMessageOnPort` available for `--experimental-worker`

## 0.3.3

### Patch Changes

- [#37](https://github.com/un-ts/synckit/pull/37) [`4ae675a`](https://github.com/un-ts/synckit/commit/4ae675ad4b0bc02ac459e9d49319154048ee40dd) Thanks [@JounQin](https://github.com/JounQin)! - fix: `worker_threads` API changes a lot

## 0.3.2

### Patch Changes

- [#35](https://github.com/un-ts/synckit/pull/35) [`578db5b`](https://github.com/un-ts/synckit/commit/578db5bd33fdd137ca09b450a211e46d3f7299cf) Thanks [@JounQin](https://github.com/JounQin)! - fix: improve compatibility with node >=8.10 <12.11

## 0.3.1

### Patch Changes

- [#34](https://github.com/un-ts/synckit/pull/34) [`255736c`](https://github.com/un-ts/synckit/commit/255736ca98731cf52aa1391d855737f45edb457f) Thanks [@JounQin](https://github.com/JounQin)! - fix: `worker_threads` is only available on Node 12

- [#32](https://github.com/un-ts/synckit/pull/32) [`d84e48e`](https://github.com/un-ts/synckit/commit/d84e48e643124c3d5801bec3147ec158ccf6db49) Thanks [@JounQin](https://github.com/JounQin)! - fix(types): stricter but internal types

## 0.3.0

### Minor Changes

- [#27](https://github.com/un-ts/synckit/pull/27) [`2809da0`](https://github.com/un-ts/synckit/commit/2809da0d25b9e4c617b3699c78cf80fbae895c6f) Thanks [@JounQin](https://github.com/JounQin)! - feat: add more env variables support

## 0.2.0

### Minor Changes

- [#23](https://github.com/un-ts/synckit/pull/23) [`6577e86`](https://github.com/un-ts/synckit/commit/6577e86bff97a6a4d803394571e9406a86dd82dc) Thanks [@JounQin](https://github.com/JounQin)! - feat: use worker_threads by default for performance

## 0.1.6

### Patch Changes

- [`b3e9760`](https://github.com/un-ts/synckit/commit/b3e976062f1c568d495ad0a578c55b83506208c9) Thanks [@JounQin](https://github.com/JounQin)! - feat: support custom TSCONFIG_PATH env

## 0.1.4

### Patch Changes

- [#9](https://github.com/un-ts/synckit/pull/9) [`cad2e05`](https://github.com/un-ts/synckit/commit/cad2e059bba51779115f63121077532b97d8aa6e) Thanks [@JounQin](https://github.com/JounQin)! - fix: try to fix clean-publish + changeset publish again

## 0.1.2

### Patch Changes

- [#7](https://github.com/un-ts/synckit/pull/7) [`0336c22`](https://github.com/un-ts/synckit/commit/0336c22a5f159fa6d35b9a6b8f93f0a56a35b3dd) Thanks [@JounQin](https://github.com/JounQin)! - fix: try to fix clean-publish + changeset publish

## 0.1.1

### Patch Changes

- [#5](https://github.com/un-ts/synckit/pull/5) [`e451004`](https://github.com/un-ts/synckit/commit/e4510040211b139a423d64eaf6607804c00a9915) Thanks [@JounQin](https://github.com/JounQin)! - fix: improve type definitions, mark tslib as dep

## 0.1.0

### Minor Changes

- [`e7446f9`](https://github.com/un-ts/synckit/commit/e7446f91421df5ee59e05adc002b3daa52dff96f) Thanks [@JounQin](https://github.com/JounQin)! - feat: first blood, should just work
