// TypeScript types for the locg-api response. Drop these into a TS consumer to
// get typed access to GET /comics/{publisher} (and /comics/new).

/** Top-level envelope returned by the release endpoints. */
export interface ComicsResponse {
  /** Release week (YYYY-MM-DD). */
  date: string;
  /** Number of base comics returned (variants are nested, not counted here). */
  count: number;
  comics: Comic[];
}

/** A base issue. Enriched fields are present when `details=true` (the default). */
export interface Comic {
  id: string;
  title: string;
  url: string | null;
  /** URL slug, used internally to build the detail-page link. */
  slug: string | null;
  cover: string | null;
  publisher: string;
  price: string | null;
  /** ISO date (YYYY-MM-DD). */
  releaseDate: string | null;
  pulls: number;
  /** Community consensus percentage (0–100). */
  rating: number | null;
  /** Distributor SKU. */
  sku: string | null;
  /** Final Order Cutoff. */
  foc: string | null;
  variantCount: number;
  variants: ComicVariant[];

  // ── Present only when details=true ──
  description?: string;
  format?: string;
  pages?: number;
  coverDate?: string;
  upc?: string;
  isbn?: string | null;
  setting?: string;
  creators?: Creator[];
  characters?: Character[];
  stories?: Story[];
}

export interface ComicVariant {
  id: string;
  name: string;
  cover: string | null;
  url: string | null;
  price: string | null;
}

export interface Creator {
  name: string;
  /** e.g. "Writer", "Artist", "Cover Artist", "Editor". */
  role: string;
  url: string | null;
}

export interface Character {
  name: string;
  /** "Main" | "Supporting" | "Cameo" */
  type: string | null;
  url: string | null;
}

export interface Story {
  title: string | null;
  pages: number | null;
}
