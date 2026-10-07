---
"synckit": patch
---

Resolve global shims from the worker for both CommonJS and ESM: the CommonJS eval entry rebinds `require` to `createRequire(workerPath)`, and the ESM entry resolves each shim against the worker's path and export conditions — `@dual-bundle/import-meta-resolve` under `node_modules`, `pnpapi` under Yarn PnP — and imports it as an absolute URL, instead of loading a generated file under the package's own `node_modules`. Availability is judged with that same resolver, and the conditions follow the worker's `execArgv` (`node-addons`, `module-sync`, `--conditions`) as well as this thread's.
