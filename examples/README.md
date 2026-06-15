# Examples

Small, dependency-free consumers of **locg-api**. Start the API first:

```bash
docker compose up -d
```

Then run any of the examples (each takes an optional publisher and base URL):

| File         | Stack                                  | Run                                   |
| ------------ | -------------------------------------- | ------------------------------------- |
| `fetch.js`   | Node 18+ (built-in `fetch`)            | `node examples/fetch.js marvel`       |
| `client.py`  | Python 3.10+ (stdlib + `@dataclass`)   | `python examples/client.py dc`        |
| `types.ts`   | TypeScript response types              | import into your project              |

All three model the same response schema documented in the [root README](../README.md#response-shape):
a `ComicsResponse` envelope (`date`, `count`, `comics[]`) where each comic carries the list-level
fields plus, when `details=true`, the enriched detail fields (`creators`, `characters`, `stories`,
`pages`, `upc`, …) and its folded-in `variants[]`.
