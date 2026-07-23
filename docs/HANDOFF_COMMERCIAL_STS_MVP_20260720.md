# Commercial STS MVP Handoff - 2026-07-20

This handoff records the current commercial STS MVP state after the 2026-07-20 operations and release-readiness pass. It intentionally contains no real credentials, tokens, salts, device IDs, bucket names, or account identifiers.

## Completed

- Preserved the personal static AccessKey mode while keeping commercial STS as an additional credential mode.
- Committed the commercial STS MVP, 0.1.1 release prep, backend admin operations, release packaging, readiness checks, CLI help, audit summaries, user plan updates, store verification, and release-note updates.
- Added admin commands for the minimum manual commercial backend:
  - `create-user <userId> [maxDevices]`
  - `update-user <userId> <plan> [maxDevices]`
  - `issue-token <userId> [expiresInDays]`
  - `disable-user <userId>` / `enable-user <userId>`
  - `list-users [limit]`
  - `list-tokens <userId>` / `revoke-token` / `revoke-token-hash`
  - `list-devices <userId>` / `forget-device <userId>`
  - `audit-log [userId] [limit]`
  - `audit-summary [userId] [windowMinutes]`
  - `verify-store`
  - `help`
- Added `/readyz` for redacted readiness and operational counts.
- Added `npm.cmd run package` for deterministic plugin packaging.
- Updated release notes and changelog to match the current 0.1.1 state.

## Latest Commits

```text
2711dba Update commercial STS release notes
2527124 Add commercial STS store verification
b8c5f53 Add commercial STS user plan updates
0e55a07 Add commercial STS audit summary
3862cee Add commercial STS admin CLI help
207cd3d Sync package lock version
9040388 Add commercial STS readiness monitoring
0af4b67 Add release packaging tooling
77da559 Add commercial STS admin operations
936e175 Prepare 0.1.1 commercial STS release
4ceba62 Add commercial STS sync MVP
```

## Verification

Last local verification in this pass:

```text
npm.cmd test: 24 test files, 165 tests passed
npm.cmd run build: passed
npm.cmd run package: passed
git diff --check: passed, with only Windows CRLF warnings
```

Latest generated install package:

```text
release\obsidian-sync-plugin-0.1.1-commercial-sts-20260720-193628.zip
```

The `release\` directory is intentionally ignored by Git.

## Safety Notes

- Do not read, print, copy, or commit `data.json`.
- Do not read, print, copy, or commit `.commercial-sts/`, `.env*`, `*.secret`, or cloud account information files.
- Admin CLI sensitive inputs stay in environment variables when raw values are unavoidable.
- Store verification and readiness output only expose redacted counts, not token hashes, device hashes, raw tokens, or cloud credentials.
- `npm audit` was not completed because it requires explicit authorization to send dependency metadata to the npm registry.

## External Checks Still Requiring a Person

- Fresh install or upgrade inside the real Obsidian UI.
- Any real Aliyun console change, billing action, or paid infrastructure change.
- Re-running production STS/OSS smoke tests against live credentials.
- Explicit approval if an online dependency audit is desired.
