# synckit

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
