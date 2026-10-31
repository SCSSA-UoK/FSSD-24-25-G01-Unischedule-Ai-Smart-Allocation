# Suggested GitHub rules

- Branches: `main` (stable), `develop` (integrated), `feature/<owner>-<topic>` for work.
- PRs target `develop` and require at least one teammate review.
- Do not merge with failing builds/tests or without updating affected API contracts.
- Avoid modifications to other members' services without their review.
- Never commit `.env`, actual faculty files, API keys, student IDs or identifiable personal records.
- Keep example fixtures fictional and stable, so all services can be tested independently.
- Commit messages describe behavior (e.g., `feat(allocation): generate one-step room swaps`).
- Each member owns unit tests for their module and contributes to an integrated demo test.
