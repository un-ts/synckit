---
"synckit": minor
---

feat: add support for `--experimental-strip-types`

A new ts runner `node`is added:

- when running on Node 22 with `--experimental-strip-types`
flag enabled via `NODE_OPTIPNS` env or cli args
- or when running on Node 23+ without `--no-experimental-strip-types`
flag enabled via `NODE_OPTIPNS` env or cli args

The default ts runner will be `node`.

When enable `node` runner on unsupported versions (<22), an error will be thrown.

On unsupported node versions, the default runner is still be `ts-node` when it's available.
