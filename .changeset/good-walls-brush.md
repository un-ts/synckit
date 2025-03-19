---
"synckit": minor
---

feat: add support for `--experimental-strip-types`

Introducing the `node` runner, which will replace `ts-node` as the new default:

- when running on Node 22 with the `--experimental-strip-types`
  flag enabled via `NODE_OPTIONS` env or cli args
- or when running on Node 23+ without `--no-experimental-strip-types`
  flag enabled via `NODE_OPTIONS` env or cli args

An error will be thrown when attempting to run with `node` on unsupported versions (<22).
On these versions, the default runner remains `ts-node` when available.
