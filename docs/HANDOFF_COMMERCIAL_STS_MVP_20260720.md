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
  - `support-report <userId> [auditWindowMinutes]`
  - `renewal-report [withinDays] [limit]`
  - `list-tokens <userId>` / `revoke-token` / `revoke-token-hash`
  - `extend-token-hash <expiresInDays>`
  - `list-devices <userId>` / `forget-device <userId>`
  - `audit-log [userId] [limit]`
  - `audit-summary [userId] [windowMinutes]`
  - `verify-store`
  - `help`
- Added `/readyz` for redacted readiness and operational counts.
- Added `npm.cmd run package` for deterministic plugin packaging and zip entry validation.
- Updated release notes and changelog to match the current 0.1.1 state.

## Latest Commits

```text
8f59b05 Add commercial STS renewal report
8793cba Add commercial STS token renewal
5a172cb Update release docs for support report
9ff6b03 Add commercial STS support report
b66c906 Update release docs for package verification
0e4e270 Verify release package contents
9d0b527 Update commercial STS release docs for user listing
e8c84cf Add commercial STS user listing
2c29c29 Add commercial STS MVP handoff
2711dba Update commercial STS release notes
2527124 Add commercial STS store verification
b8c5f53 Add commercial STS user plan updates
```

## Verification

Last local verification in this pass:

```text
npm.cmd test: 24 test files, 169 tests passed
npm.cmd run build: passed
npm.cmd run package: passed
git diff --check: passed, with only Windows CRLF warnings
```

Latest generated install package:

```text
release\obsidian-sync-plugin-0.1.1-commercial-sts-20260723-134327.zip
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
