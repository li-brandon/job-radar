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
- `titlesExclude`: title keywords to drop.
- `companiesExclude`: company names to drop (default `[]`).
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

## Fetching jobs

### Greenhouse

`fetchGreenhouseJobs(watchlist, options?)` reads each `greenhouse` entry's
public board from the Greenhouse Job Board API
(`GET https://boards-api.greenhouse.io/v1/boards/{boardToken}/jobs`) and returns
`{ jobs, errors }`. Lever and Ashby entries are ignored.

- **Read-only.** One unauthenticated GET per board per run, no retries, sent
  with a `User-Agent` that identifies job-radar as a read-only client. Requests
  are spaced out by a short delay (`delayMs`, default 500 ms). No API keys, no
  Harvest API, no scraping, nothing is ever posted.
- **One board failing does not abort the run.** An HTTP error, network error,
  timeout, invalid JSON, or unexpected payload for one board is logged and
  added to `errors` (with company, board token, URL, and reason). The other
  boards are still fetched.
- **Nothing runs on import.** The network is only touched when you call the
  fetcher. Pass `options.fetch` to supply your own `fetch`.

Each opening becomes a shared `Job` record:

- `company`: the watchlist entry's `company` (not the API payload).
- `title`: `title`.
- `location`: `location.name`, or `""` if missing.
- `remote`: `true` when the location contains the word "remote" (any case).
- `link`: `absolute_url`.
- `postedAt`: `first_published`, else `updated_at`, as an ISO 8601 UTC string
  (for example `2026-01-15T12:00:00.000Z`); `null` if neither is usable.
- `provider`, `boardToken`, `sourceJobId`: source metadata for later dedupe
  (`"greenhouse"`, the entry's board token, and the Greenhouse job `id` as a
  string).

Tests use saved, fictional fixtures under `test/fixtures/greenhouse/` and a
stubbed `fetch`. `test/setup.ts` replaces the global `fetch` with one that
throws, so a test that forgets to inject a stub fails instead of calling the
live API.

### Lever

`fetchLeverJobs(watchlist, options?)` reads each `lever` entry's public
postings from the Lever Postings API
(`GET https://api.lever.co/v0/postings/{boardToken}?mode=json`) and returns
`{ jobs, errors }`. Greenhouse and Ashby entries are ignored.

It follows the same rules as the Greenhouse fetcher: read-only, one
unauthenticated GET per board per run (a repeated board token is only fetched
once), no retries, the same `User-Agent` and `delayMs`, and one failed board is
logged and added to `errors` without aborting the run.

- `title`: `text`.
- `location`: `categories.location`, or `""` if missing.
- `remote`: `true` when `workplaceType` is `"remote"` (any case) or the
  location contains the word "remote".
- `link`: `hostedUrl`.
- `postedAt`: `createdAt` (Unix epoch milliseconds or an ISO string), as an ISO
  8601 UTC string; `null` if missing.
- `sourceJobId`: the Lever posting `id`.

### Ashby

`fetchAshbyJobs(watchlist, options?)` reads each `ashby` entry's public job
board from the Ashby Job Posting API
(`GET https://api.ashbyhq.com/posting-api/job-board/{boardToken}`) and returns
`{ jobs, errors }`. Greenhouse and Lever entries are ignored.

Same rules again: read-only, one unauthenticated GET per board per run, no
retries, the same `User-Agent` and `delayMs`, and one failed board does not
abort the run.

- `title`: `title`.
- `location`: `location`, or `""` if missing.
- `remote`: when `workplaceType` is set, `true` only if it is `Remote` (`Hybrid`
  and `OnSite` are not remote, even though Ashby sets `isRemote` on Hybrid
  jobs). Without `workplaceType`, `true` when `isRemote` is `true` or the
  location contains the word "remote".
- `link`: `jobUrl`.
- `postedAt`: `publishedAt`, else `listedAt`, as an ISO 8601 UTC string; `null`
  if neither is usable.
- `sourceJobId`: the Ashby job `id`.

For both, `company` comes from the watchlist entry and `provider` /
`boardToken` are the source metadata. Tests use fictional fixtures under
`test/fixtures/lever/` and `test/fixtures/ashby/` with a stubbed `fetch`; no
test calls the live APIs.

## Matching, scoring, and dedupe

### Matching and scoring

`matchJobs(jobs, profile)` drops jobs the profile rules out and returns the
rest as `{ job, score, titleMatch, locationMatch }`, highest score first (equal
scores keep their input order). `matchJob(job, profile)` does the same for one
job and returns `null` when it is dropped. The original `Job` objects are never
changed.

Titles, companies, and locations are compared after normalization: lowercase,
accents removed, `&` read as "and", and punctuation and extra whitespace
collapsed to single spaces. Titles also expand `Sr`/`Sr.` to "senior" and
`Jr`/`Jr.` to "junior", so "Sr. Widget Engineer" and "Senior Widget Engineer"
are the same title. Title and location phrases match on whole words: "Manager"
matches "Widget Manager", but "Intern" does not match "Internal".

A job is dropped when:

- its company equals an entry in `companiesExclude` (after normalization, so
  case, extra spaces, and punctuation are ignored);
- its title contains a `titlesExclude` keyword;
- its title contains no `titlesInclude` or `titlesStretch` phrase; or
- `remote.usRemote` is `"off"`, the job is remote, and its location matches
  none of your `locations`.

Every other job is kept and scored (see `SCORE_WEIGHTS`):

- **Title.** `titlesInclude` is worth 10, `titlesStretch` 5. When phrases from
  both lists match, the longest one decides (ties go to include). For example,
  with "Widget Engineer" included and "Senior Widget Engineer" as a stretch,
  "Sr. Widget Engineer, Gears" is a stretch match. Title always outweighs
  location.
- **Location.** The job's location text containing any location `name` or
  alias is a `"location"` match, worth 4. A remote job that doesn't match a
  location is `"remote"`: worth 2 with `"fallback"`, 4 with `"allowed"`. Every
  remote job is treated as US-remote. On-site jobs elsewhere are kept as
  `"none"`, worth 0.
- **Pay.** Jobs don't carry pay data yet, so every job counts as unlisted pay
  and is kept (`pay.unlistedPay: "keep"`). Seniority years and industries are
  not scored.

### Dedupe keys

`dedupeKey(job)` is the normalized company, title, and location joined by `|`,
for example `example corp|senior widget engineer|example city`. Provider, board
token, and job id are not part of the key, so the same opening on two boards
counts once. Location normalization is deliberately conservative:

- Any location with the word "remote" drops "remote" and US country names
  (`US`, `U.S.`, `USA`, `United States`), so "Remote", "Remote - US",
  "US Remote", and "Remote (United States)" are all `remote`. Other regions
  stay: "Remote - Canada" is `remote canada`. An empty location on a remote job
  is `remote`.
- Other locations drop trailing comma-separated US country names, then one
  trailing comma-separated two-letter code. So "Example City", "Example City,
  EX", and "Example City, EX, USA" are all `example city`. "Example City EX"
  (no comma) is kept as is. Two places with the same name in different states
  would share a key; with the same company and title too, that is rare.

`dedupeJobs(items)` keeps one item per key, at the position of the key's first
occurrence. It takes raw jobs or scored matches. When both items are scored the
higher score wins; otherwise the first one is kept.

### Seen jobs across runs

Jobs already reported in earlier runs are tracked by dedupe key in
`data/seen-jobs.local.json` (`DEFAULT_SEEN_JOBS_PATH`, relative to the current
working directory). It is gitignored by the `*.local.json` rule and holds real
company names and titles, so **never commit it**. Its shape is:

```json
{
  "version": 1,
  "jobs": [
    {
      "key": "example corp|widget engineer|example city",
      "firstSeenAt": "2026-01-15T12:00:00.000Z"
    }
  ]
}
```

- `loadSeenJobs(path?)` reads it. A missing file is an empty list. A file that
  is not valid JSON or has the wrong shape throws `SeenJobsError` instead of
  silently resetting the history.
- `filterUnseen(items, seen)` returns the jobs or matches whose key is not in
  the list.
- `recordSeen(seen, items, now?)` returns a new list with their keys added. Keys
  already present keep their original `firstSeenAt`.
- `saveSeenJobs(seen, path?)` writes the list, creating the directory if
  needed.

Every function takes a path, so tests use temp files and never touch the real
seen file.

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
