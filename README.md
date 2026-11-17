# job-radar

Read-only daily feed of new openings from target companies' public ATS job boards
(Greenhouse, Lever, Ashby).

## Compliance rules

These are hard rules for this project. Changes that break them will not be merged.

- **Read-only sources.** job-radar only reads public job-board APIs. It never
  submits applications, creates accounts, or writes to those job boards.
- **No LinkedIn scraping.** job-radar does not scrape or call LinkedIn in any way.
  Sources are limited to the public Greenhouse, Lever, and Ashby job-board APIs.
- **No auto-apply.** job-radar never applies to jobs. It only produces a list for
  a human to review.
- **No personal data in the repo.** The real search profile and watchlist live in
  a gitignored local config file. Only the fictional example config is committed.
  Never commit secrets, emails, or other personal details.

## Setup

Requires Node 22 (see `.nvmrc`) and npm.

```sh
git clone https://github.com/li-brandon/job-radar.git
cd job-radar
nvm use        # optional, picks up Node 22 from .nvmrc
npm ci
cp config/job-radar.example.json config/job-radar.local.json
```

Edit `config/job-radar.local.json` with your own profile and watchlist. It is
gitignored (everything in `config/` except `*.example.*` files is ignored), so it
stays on your machine. The config shape is provisional until the config loader
lands.

## Development

```sh
npm run lint       # ESLint + Prettier check
npm run format     # Prettier write
npm run typecheck  # tsc --noEmit
npm test           # Vitest
```

CI runs `npm ci`, lint, typecheck, and tests on every pull request and on pushes
to `main`. Tests must not make network calls; use fixtures.

## License

MIT
