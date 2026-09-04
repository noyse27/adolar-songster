# Adolar Songster v0.5.2-beta

Release date: 2026-09-04

## Highlights

- Mobile playboards now show the round countdown, making the transition from
  countdown to song window and input lock clearer on phones.
- The current player's own timeline is prioritized in the playboard, improving
  mobile usability during active rounds.
- Active playboards keep their table sessions alive from the client, reducing
  accidental cleanup while a game is still in use.

## Fixes and Stability

- Admin table deletion and inactivity cleanup are safer, including cascade
  handling for auto-ready preferences.
- Adolar base URL handling was hardened.
- Beta debug logging and request IDs were added for easier troubleshooting.
- Local integration test database usage is documented.

## Maintenance

- Added Dependabot version updates.
- Updated CI action versions.
- Bumped current Docker, Node, Vite, React Hooks ESLint, Express rate limit, and
  test dependency ranges through the current dependency PRs.

## Notes

- This release follows `v0.5.1-beta` and closes the Mobile-Countdown work from
  2026-09-04 that was already on `main` but not yet tagged or documented as a
  release.
