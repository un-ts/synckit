---
"synckit": patch
---

Resolve global shims from the worker's own directory for both CommonJS and ESM: the CommonJS eval entry rebinds `require` to `createRequire(workerPath)`, and the ESM entry imports each shim from its worker-relative URL instead of a generated file under the package's `node_modules`.
