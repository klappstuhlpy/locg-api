# comic-api

A small, self-hosted **Node.js / Express** service that turns [League of Comic Geeks](https://leagueofcomicgeeks.com) weekly release data into clean JSON.

It fetches the weekly Marvel/DC release list, **folds variant covers into their base issue**, and **enriches each book** with the metadata that only lives on the individual comic page (creators, characters, page count, UPC, cover date, story breakdown, …). Cloudflare is handled transparently via [FlareSolverr](https://github.com/FlareSolverr/FlareSolverr), so it runs fine from a datacenter/VPS IP.

> ⚠️ **Unofficial.** This project scrapes a third-party website that has no public API. It is intended for personal/hobby use (e.g. a Discord release-feed bot). Respect League of Comic Geeks' Terms of Service, cache aggressively, and keep request volume low. Not affiliated with or endorsed by League of Comic Geeks.

---

## Why this exists

League of Comic Geeks has no public API. Its site renders releases through an internal `get_comics` endpoint that returns an HTML fragment, and every richer detail (creators, characters, UPC, etc.) is server-rendered into each comic's own page. On top of that, the whole site is behind Cloudflare, which 403s most non-residential IPs.

This service wraps all of that behind a tiny REST API:

```
                                  ┌──────────────────────────────┐
  GET /comics/marvel  ─────────▶  │  comic-api (Express)         │
                                  │   1. list  → get_comics       │
                                  │   2. group variants by parent │
                                  │   3. enrich each base comic   │
                                  │      from its detail page     │
                                  └───────────────┬──────────────┘
                                                  │ request.get
                                                  ▼
                                       ┌────────────────────┐
                                       │   FlareSolverr     │  (headless Chrome,
                                       │  clears Cloudflare │   solves the challenge)
                                       └─────────┬──────────┘
                                                 ▼
                                    leagueofcomicgeeks.com
```

## Features

- **One call, fully enriched.** `GET /comics/marvel` returns the week's base issues with creators, characters, page count, format, cover date, UPC/ISBN, distributor SKU, FOC, story breakdown and variants — no second request.
- **Variants folded into the base issue.** The weekly list surfaces every cover (a popular book can have 70+ variants). They're grouped onto the base issue as a `variants[]` array instead of polluting the feed with duplicates.
- **Cloudflare bypass via FlareSolverr.** Works from VPS/datacenter IPs that LOCG would otherwise block.
- **Per-comic caching.** Detail enrichment is cached (default 7 days) since releases don't change after they ship — so only newly listed books are scraped on each refresh.
- **Bounded concurrency.** Detail pages are scraped a couple at a time to stay gentle on FlareSolverr's single browser.
- **Graceful degradation.** If a detail page can't be read, the book is still returned with its list-level fields.
- **High-resolution covers.** Cover URLs are upgraded from `medium-` to `large-` for crisper rendering.
- **`details=false` fast path** when you only need the list-level fields.

## Prerequisites

- **Docker + Docker Compose** (recommended — brings up FlareSolverr for you), or
- **Node.js ≥ 18** and a reachable [FlareSolverr](https://github.com/FlareSolverr/FlareSolverr) instance.

## Quick start (Docker Compose)

```bash
git clone <your-fork-url> comic-api
cd comic-api
docker compose up -d --build
```

This starts two containers:

| Service        | Port   | Purpose                                  |
| -------------- | ------ | ---------------------------------------- |
| `comic-api`    | `8070` | the REST API                             |
| `flaresolverr` | `8191` | headless browser that clears Cloudflare  |

Verify it's up:

```bash
curl http://localhost:8070/health
curl "http://localhost:8070/comics/marvel" | jq '.count, .comics[0].title'
```

> The first request of the week is slow — FlareSolverr launches Chromium and each base comic's page is scraped once. Subsequent requests are served from cache until it expires.

## Configuration

All configuration is via environment variables (see [`.env.example`](.env.example)):

| Variable             | Default                    | Description                                                        |
| -------------------- | -------------------------- | ------------------------------------------------------------------ |
| `PORT`               | `8070`                     | Port the API listens on.                                           |
| `FLARESOLVERR_URL`   | `http://flaresolverr:8191` | Base URL of the FlareSolverr instance.                             |
| `FLARESOLVERR_TIMEOUT` | `60000`                  | Per-request FlareSolverr timeout (ms).                             |
| `DETAIL_TTL_HOURS`   | `168`                      | How long to cache a comic's scraped detail (hours). `168` = 7 days. |
| `DETAIL_CONCURRENCY` | `2`                        | Max detail pages scraped in parallel.                              |

## API reference

All responses are `application/json`. Dates default to the **current release week** (the upcoming Wednesday) when `date` is omitted.

### `GET /comics/marvel` · `GET /comics/dc`

Shortcuts for this week's Marvel or DC releases.

| Query param | Default        | Description                                   |
| ----------- | -------------- | --------------------------------------------- |
| `date`      | this Wednesday | Release week, `YYYY-MM-DD`.                   |
| `details`   | `true`         | Set `false` to skip detail-page enrichment.   |

### `GET /comics/new`

Generic endpoint with explicit publisher selection.

| Query param | Default        | Description                                          |
| ----------- | -------------- | ---------------------------------------------------- |
| `date`      | this Wednesday | Release week, `YYYY-MM-DD`.                          |
| `publisher` | all            | Comma-separated: `marvel`, `dc` (e.g. `marvel,dc`).  |
| `details`   | `true`         | Set `false` to skip detail-page enrichment.          |

### `GET /health`

Liveness probe → `{ "status": "ok" }`.

### Response shape

```jsonc
{
  "date": "2026-06-17",
  "count": 20,
  "comics": [
    {
      "id": "4978476",
      "title": "The Amazing Spider-Man #31",
      "url": "https://leagueofcomicgeeks.com/comic/4978476/the-amazing-spider-man-31",
      "slug": "the-amazing-spider-man-31",
      "cover": "https://s3.amazonaws.com/comicgeeks/comics/covers/large-4978476.jpg",
      "publisher": "Marvel Comics",
      "price": "$4.99",
      "releaseDate": "2026-06-17",
      "pulls": 59618,
      "rating": 92,

      // ── enriched (details=true) ──────────────────────────────
      "description": "THE TALK... Peter Parker's world will never be the same. …",
      "format": "Comic",
      "pages": 32,
      "coverDate": "Aug 2026",
      "upc": "75960621001503111",
      "isbn": null,
      "sku": "APR260020",
      "foc": "May 18th",
      "setting": "Earth-616",
      "creators": [
        { "name": "Joe Kelly", "role": "Writer", "url": "https://leagueofcomicgeeks.com/people/1665/joe-kelly" },
        { "name": "Patrick Gleason", "role": "Artist", "url": "…" }
      ],
      "characters": [
        { "name": "Spider-Man", "type": "Main", "url": "https://leagueofcomicgeeks.com/character/29/spider-man" }
      ],
      "stories": [ { "title": "The Talk", "pages": 20 } ],

      // ── variants folded in from the list ─────────────────────
      "variantCount": 12,
      "variants": [
        { "id": "1693201", "name": "Chris Ng Variant", "cover": "https://…/large-1693201.jpg",
          "url": "https://leagueofcomicgeeks.com/comic/4978476/…?variant=1693201", "price": "$19.99" }
      ]
    }
  ]
}
```

#### Field notes

- **`rating`** — League's community consensus percentage (0–100), read from the list view.
- **`slug`** — internal URL slug used to build the detail-page request; handy if you want to link out.
- **Enriched fields** (`description` full text, `format`, `pages`, `coverDate`, `upc`, `isbn`, `sku`, `foc`, `setting`, `creators`, `characters`, `stories`) are only present when `details=true` (the default) and the detail page was readable. With `details=false` you get the list-level fields only.
- **`creators[].role`** covers interior credits plus cover artists and production roles. The same person may appear under multiple roles.
- **`characters[].type`** is `Main`, `Supporting`, or `Cameo`; each character appears once, under its strongest billing.

## Local development (without Docker)

You still need a reachable FlareSolverr instance:

```bash
docker run -d --name flaresolverr -p 8191:8191 ghcr.io/flaresolverr/flaresolverr:latest

npm install
FLARESOLVERR_URL=http://localhost:8191 npm start
```

## How it works (internals)

1. **List** — `parseReleases()` hits `get_comics` (via FlareSolverr), parses the HTML fragment, and splits rows into base issues (`data-parent="0"`) and variants (which carry their parent's id). Variants are attached to the matching base as `variants[]`.
2. **Enrich** — for each base issue, `enrichComic()` fetches `/comic/<id>/<slug>` (cached, concurrency-limited) and `parseDetail()` scrapes the rich fields.
3. **Serve** — the merged objects are returned in one response.

Selectors live in `index.js` and may need updating if League of Comic Geeks changes its markup.

## Acknowledgements

- [League of Comic Geeks](https://leagueofcomicgeeks.com) — the upstream data source.
- [FlareSolverr](https://github.com/FlareSolverr/FlareSolverr) — Cloudflare challenge solver.
- [`alistairjcbrown/leagueofcomicgeeks`](https://github.com/alistairjcbrown/leagueofcomicgeeks) — prior-art Node library for LOCG that informed the list-parsing approach.
- Built with [Express](https://expressjs.com), [cheerio](https://cheerio.js.org), and [node-fetch](https://github.com/node-fetch/node-fetch).

## License

[MIT](LICENSE)
