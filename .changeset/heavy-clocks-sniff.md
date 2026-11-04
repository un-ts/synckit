---
"synckit": minor
---

`.ts` workers no longer get `--experimental-transform-types` and its experimental warning on Node `>=22.18 <23`, where type stripping is on by default, or when `execArgv` already has `--experimental-strip-types`

**Breaking:** in these cases, workers that use enums or other TypeScript features that type stripping doesn't support now need `--experimental-transform-types` in `execArgv`
