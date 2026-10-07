---
"synckit": patch
---

Use `node-fetch-native` for the default global `fetch` shim instead of `node-fetch`: it is a dual ESM/CommonJS package that prefers the native `fetch` and only falls back to its own implementation, so the shim is no longer tied to the CommonJS-only `node-fetch` v2. The shim imports the named `fetch` export, because `require('node-fetch-native')` is the module namespace rather than the function. If you enable `SYNCKIT_GLOBAL_SHIMS`, install `node-fetch-native` instead of `node-fetch`.
