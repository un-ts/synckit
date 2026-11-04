---
"synckit": patch
---

`.ts` workers on Node 22.18+ no longer get `--experimental-transform-types` and its experimental warning, as type stripping is on by default there, like on Node 23.6+. On older Node, the flag is also no longer added when `execArgv` already has `--experimental-strip-types`. A worker that needs the flag can still get it via `execArgv`
