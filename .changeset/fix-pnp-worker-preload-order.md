---
"synckit": patch
---

Fix workers never starting under Yarn PnP since v0.12: the failure guard (`register.cjs`) was preloaded ahead of the PnP API require inherited from Yarn, but the guard lives inside the project's package archive and cannot be read until `.pnp.cjs` has patched module resolution. The worker then died at startup with nothing left to report it, so every `createSyncFn` call waited in `Atomics.wait()` until its timeout. Under PnP the worker's `NODE_OPTIONS` now opens with the PnP API require and the guard follows it; every other inherited preload still loads after the guard, and the "already inherited" check scans the whole value so a nested worker does not add a second guard.
