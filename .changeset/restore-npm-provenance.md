---
"synckit": patch
---

Restore the npm provenance attestation on releases. `changesets` 3 publishes Yarn projects with `yarn npm publish`, which only writes a provenance statement when `npmPublishProvenance` (or `publishConfig.provenance`) asks for it, so `0.12.0` onwards shipped without npm's "Built and signed with provenance" badge.
