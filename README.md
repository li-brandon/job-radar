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
gitignored (everything in `config/` except `*.example.*` files is ignored, and
`*.local.json` is ignored anywhere), so it stays on your machine. **Never commit
your real search profile or watchlist.** The committed example and all test
fixtures use fictional placeholders only.

### Config shape

`config/job-radar.example.json` shows every field. The config has two parts:

`profile` — what to look for:

- `titlesInclude` (required): titles to match, at least one.
- `titlesStretch`: titles that are still allowed but rank below
  `titlesInclude`.
- `titlesExclude`: titles to drop.
- `seniority` (required): a `label` plus optional whole-number `minYears` and
  `maxYears` (`minYears` must not exceed `maxYears`).
- `locations`: each entry has a display `name` and optional `aliases` (other
  place names for the same area).
- `remote.usRemote` (required): `"fallback"`, `"allowed"`, or `"off"` (see
  below).
- `pay.minTopOfRangeBaseUsd` (required): minimum acceptable top of a listed
  base-pay range, in whole US dollars.
- `pay.belowMinimum`: `"flag"` (default) or `"demote"`.
- `pay.unlistedPay`: `"keep"` (the default and only option).
- `industries`: free-form industry tags.

`watchlist` — at least one company, each with `company`, `provider`
(`greenhouse`, `lever`, or `ashby`), and `boardToken` (the company's public
board identifier on that provider).

Unknown keys are rejected so typos surface early. A top-level `_comment` string
is allowed for notes.

**Pay rule.** If a posting lists a base-pay range and the top of that range is
below `pay.minTopOfRangeBaseUsd`, the posting is flagged or demoted (per
`pay.belowMinimum`). Postings that do not list pay are always kept.

**US-remote fallback.** `"fallback"` keeps US-remote postings but ranks them
below postings in one of your `locations`. `"allowed"` treats US-remote the same
as a location match. `"off"` drops US-remote postings that don't match a
location (at least one location is then required).

### Loading the config

`loadConfig(path?)` reads, parses, and validates a config file and returns a
typed object. With no argument it reads `config/job-radar.local.json` relative
to the current working directory. Any problem (missing file, invalid JSON,
missing or invalid fields, unknown keys, unknown provider, empty watchlist,
duplicate boards) throws a `ConfigError` whose message lists every issue with
its field path, for example `watchlist[0].provider: ...`.

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
