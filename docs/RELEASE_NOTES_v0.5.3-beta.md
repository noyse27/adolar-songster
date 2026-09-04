# Adolar Songster v0.5.3-beta

Release date: 2026-09-04

## Highlights

- Resolves the remaining moderate `qs` advisories reported through Express'
  dependency tree.
- Upgrades the backend to Express 5.2.1 and removes `express-async-errors`,
  relying on Express 5's native async error forwarding.
- Pins `qs` 6.16.0 at the workspace root and backend level so Express,
  body-parser, and Superagent resolve to the audited version.

## Verification

- `npm audit --json` reports zero vulnerabilities.
- `npm run lint --if-present`
- `npm run build --if-present`

## Notes

- This follows `v0.5.2-beta`, which documented the mobile playboard countdown.
  It exists so the current Songster release line has no remaining dependency
  audit tail.
