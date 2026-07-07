# Changelog

> From v0.2.1 on, per-worker changelogs live in `workers/*/CHANGELOG.md` (release-please switched to per-worker component releases in Spec 03; this root file is frozen and no longer release-managed). The history below predates that split.

## [0.2.1](https://github.com/apostolos-geyer/greenroom/compare/v0.2.0...v0.2.1) (2026-07-04)

### Bug Fixes

- **sprout:** brand admins locked out of /admin after their first portal visit ([#34](https://github.com/apostolos-geyer/greenroom/issues/34)) ([32fe09b](https://github.com/apostolos-geyer/greenroom/commit/32fe09bd76cbb7ce9ac16c2cf80f2855b92bbe88))

## [0.2.0](https://github.com/apostolos-geyer/greenroom/compare/v0.1.1...v0.2.0) (2026-07-04)

### Features

- **deploy:** tag-triggered prod CD + bouncer-fronted marketing/hub/org routing ([#26](https://github.com/apostolos-geyer/greenroom/issues/26)) ([e6e089c](https://github.com/apostolos-geyer/greenroom/commit/e6e089c196848dee633358fe863941555563bfd9))

### Bug Fixes

- **bouncer:** drop prod _.somewhatintelligent.ca/_ zone route that shadowed staging ([#29](https://github.com/apostolos-geyer/greenroom/issues/29)) ([f31ec7a](https://github.com/apostolos-geyer/greenroom/commit/f31ec7a1f1bfe1c576dfcca2ead170617fdbbcac))
- **deploy:** fix worker dependency order, was deploying guestlist before roadie/promoter ([45c6ec0](https://github.com/apostolos-geyer/greenroom/commit/45c6ec0fe1d3ed4931fb6010c4be7bc14274e27c))
- **release:** require explicit manual approval for a production deploy ([f40d325](https://github.com/apostolos-geyer/greenroom/commit/f40d325644859dbcf93e10e8169f96d3fff520bd))
- **release:** stop release-please from matching zero releases ([#24](https://github.com/apostolos-geyer/greenroom/issues/24)) ([7b7b274](https://github.com/apostolos-geyer/greenroom/commit/7b7b2749e6eaf6805a133de92d7c7a429068b2fc))
- **rwx:** stop release-please from silently dropping tag cuts; unify deploy logic ([#23](https://github.com/apostolos-geyer/greenroom/issues/23)) ([b5d10c1](https://github.com/apostolos-geyer/greenroom/commit/b5d10c17893164e24439ec9ec3eecd656b84afa7))
- **sprout:** apex SPROUT_URL — Hub returnTo + org portal URLs resolve ([#28](https://github.com/apostolos-geyer/greenroom/issues/28)) ([8141a7c](https://github.com/apostolos-geyer/greenroom/commit/8141a7cd6765091ca493b36011541338dc638372))
- **sprout:** apply fixed-mode brand themes on the live portal ([#30](https://github.com/apostolos-geyer/greenroom/issues/30)) ([845588e](https://github.com/apostolos-geyer/greenroom/commit/845588ea8fc0ba522b6bc2854ede08e3961f537d))

## [0.1.1](https://github.com/apostolos-geyer/greenroom/compare/v0.1.0...v0.1.1) (2026-06-30)

### CI / Deploy

- **release:** run release-please on RWX instead of GitHub Actions ([#21](https://github.com/apostolos-geyer/greenroom/issues/21)) ([055c88d](https://github.com/apostolos-geyer/greenroom/commit/055c88d9ff88abf578927ad2b957c3fb256d9226))
