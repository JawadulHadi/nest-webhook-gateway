# Changelog

All notable changes to nest-webhook-gateway. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). The project has no version tags yet, so
past entries are grouped by merged pull request and date.

Every change adds an entry under **Unreleased** in the same pull request. CI checks this.

## [Unreleased]

### Added
- `docs/deployment.md`: the Render blueprint step by step, the free-tier limits, and why this repo
  stays on Render instead of Vercel (the BullMQ worker has to keep running between requests).
- `CHANGELOG.md` (this file), a pull request template, and a CI job that fails a pull request
  which doesn't update the changelog. Label a PR `skip-changelog` to bypass it.

### Security
- The `changelog` CI workflow now limits its token to read-only repository access.

## PR #2 (2026-10-12)

### Added
- First real `NOTES.md` entries.

## PR #1 (2026-10-12)

### Added
- Architecture diagram in the README, Render free-tier blueprint (web service + Key Value),
  MIT license and `.env.example`.
- CI with a real Redis service: typecheck, unit tests, Redis integration tests and build.

## Initial commit (2026-10-12)

### Added
- NestJS webhook gateway: per-source HMAC verification, timestamp replay protection, idempotency,
  BullMQ delivery with jittered exponential backoff and dead-lettering, signed outbound requests,
  and an admin-protected deliveries endpoint.
