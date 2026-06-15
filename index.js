const express = require("express");
const fetch = require("node-fetch");
const cheerio = require("cheerio");

const app = express();
const PORT = process.env.PORT || 8070;
const ROOT_URL = "https://leagueofcomicgeeks.com";
const FLARESOLVERR_URL = process.env.FLARESOLVERR_URL || "http://flaresolverr:8191";
const FLARESOLVERR_TIMEOUT = parseInt(process.env.FLARESOLVERR_TIMEOUT, 10) || 60000;

// Detail pages are scraped per base comic, which is the expensive part. Releases
// don't change after they ship, so cache each comic's enrichment for a week and
// fetch only a couple of pages at a time to stay gentle on FlareSolverr.
const DETAIL_TTL_MS = (parseInt(process.env.DETAIL_TTL_HOURS, 10) || 168) * 3600 * 1000;
const DETAIL_CONCURRENCY = parseInt(process.env.DETAIL_CONCURRENCY, 10) || 2;

const PUBLISHERS = {
  "DC Comics": 1,
  "Marvel Comics": 2,
};

// id -> { data, expires }
const detailCache = new Map();

function formatDate(date) {
  const d = date || new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getWednesday(date) {
  const d = new Date(date || Date.now());
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -4 : 3);
  d.setDate(diff);
  return d;
}

function absUrl(href) {
  const h = (href || "").trim();
  if (!h) return null;
  return h.startsWith("http") ? h : ROOT_URL + h;
}

function clean(text) {
  return (text || "").replace(/\s+/g, " ").trim();
}

function slugFromHref(href) {
  const m = (href || "").match(/\/comic\/\d+\/([^?]+)/);
  return m ? m[1] : null;
}

// Material-icon <span>s render as ligature words ("event_busy", "expand_more")
// that otherwise bleed into scraped text (e.g. the FOC value). Drop them.
function stripIcons($) {
  $(".material-icons, .material-icons-outlined, .material-symbols-outlined").remove();
}

// LOCG serves covers in size buckets (small-/medium-/large-/…). The list uses
// medium-; prefer the higher-resolution large- variant for crisper rendering.
function upscaleCover(url) {
  return url ? url.replace("/medium-", "/large-") : url;
}

// ── Weekly list ────────────────────────────────────────────────────────────
// The list view returns every cover for the week, including variants. Variants
// carry data-parent pointing at the base issue's id; we fold them into the base
// instead of surfacing them as standalone releases.

function parseListRow($el) {
  const id = $el.attr("data-comic") || null;
  if (!id) return null;

  const titleLink = $el.find(".title a").first();
  const name = clean(titleLink.text());
  if (!name) return null;

  const href = (titleLink.attr("href") || "").trim();
  const variantName = clean($el.find(".variant-name").first().text()) || null;

  const coverImg = $el.find(".comic-cover-art img").first();
  let coverRaw = coverImg.attr("data-src") || coverImg.attr("src") || "";
  if (coverRaw.startsWith("data:")) coverRaw = "";
  const cover = coverRaw.includes("no-cover") ? null : upscaleCover(absUrl(coverRaw.split("?")[0]));

  const $details = $el.find(".comic-details").first();
  const publisher = clean($details.find(".publisher").text());
  const price = clean($details.find(".price").first().text()) || null;

  // The date span carries a unix timestamp; emit ISO so the consumer parses it
  // unambiguously (the visible text "Jun 17th, 2026" trips most date parsers).
  const $date = $details.find(".date").first();
  const ts = parseInt($date.attr("data-date"), 10);
  const releaseDate = Number.isFinite(ts)
    ? new Date(ts * 1000).toISOString().slice(0, 10)
    : clean($date.text()) || null;

  const $desc = $el.find(".comic-description p").first();
  $desc.find("a").remove(); // drop the trailing "View »" link
  const description = clean($desc.text()) || null;

  return {
    id,
    parentId: $el.attr("data-parent") || "0",
    name,
    variantName,
    title: variantName ? clean(name.replace(variantName, "")) : name,
    url: absUrl(href),
    slug: slugFromHref(href),
    cover,
    publisher,
    price,
    releaseDate,
    description,
    pulls: parseInt($el.attr("data-pulls"), 10) || 0,
    rating: parseFloat($el.attr("data-community")) || null, // community consensus %
    sku: clean($el.find(".comic-diamond-sku").first().text()) || null,
    foc: clean($el.find(".comic-foc").first().text().replace(/FOC:/i, "")) || null,
  };
}

function parseReleases(html) {
  const $ = cheerio.load(html);
  stripIcons($);
  const bases = new Map();
  const variantsByParent = new Map();

  $("li[data-comic]").each(function () {
    const row = parseListRow($(this));
    if (!row) return;

    if (row.parentId && row.parentId !== "0") {
      if (!variantsByParent.has(row.parentId)) variantsByParent.set(row.parentId, []);
      variantsByParent.get(row.parentId).push({
        id: row.id,
        name: row.variantName || row.name,
        cover: row.cover,
        url: row.url,
        price: row.price,
      });
      return;
    }

    bases.set(row.id, {
      id: row.id,
      title: row.title,
      url: row.url,
      slug: row.slug,
      cover: row.cover,
      publisher: row.publisher,
      price: row.price,
      releaseDate: row.releaseDate,
      description: row.description,
      pulls: row.pulls,
      rating: row.rating,
      sku: row.sku,
      foc: row.foc,
      variants: [],
    });
  });

  for (const [parentId, variants] of variantsByParent) {
    const base = bases.get(parentId);
    if (base) base.variants = variants;
  }
  for (const base of bases.values()) base.variantCount = base.variants.length;

  return [...bases.values()];
}

// ── Detail page ──────────────────────────────────────────────────────────────
// Fields that only exist on the individual comic page: long description, page
// count, cover date, UPC/ISBN, distributor SKU, FOC, creators (by role),
// characters, and per-story breakdown.

function dedupeCreators(creators) {
  const seen = new Set();
  return creators.filter((c) => {
    const key = `${c.role}::${c.name}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// The page lists characters per story, so the same character recurs (often in
// different roles). Collapse to one entry per name, keeping its strongest role.
function dedupeCharacters(characters) {
  const rank = { Main: 0, Supporting: 1, Cameo: 2 };
  const best = new Map();
  for (const c of characters) {
    const existing = best.get(c.name);
    if (!existing || (rank[c.type] ?? 9) < (rank[existing.type] ?? 9)) {
      best.set(c.name, c);
    }
  }
  return [...best.values()];
}

function parseDetail(html) {
  const $ = cheerio.load(html);
  stripIcons($);
  const detail = {};

  const descParts = [];
  $("#summary .listing-description p").each(function () {
    const t = clean($(this).text());
    if (t) descParts.push(t);
  });
  if (descParts.length) detail.description = descParts.join("\n\n");

  // "Comic · 32 pages · $4.99"
  const intro = clean($("#summary .font-italic").first().text());
  if (intro) {
    const parts = intro.split("·").map((p) => p.trim()).filter(Boolean);
    if (parts[0]) detail.format = parts[0];
    const pagesPart = parts.find((p) => /page/i.test(p));
    const pages = pagesPart ? parseInt(pagesPart, 10) : NaN;
    if (Number.isFinite(pages)) detail.pages = pages;
  }

  $(".details-addtl-block").each(function () {
    const label = clean($(this).find(".name").first().text()).toLowerCase();
    const value = clean($(this).find(".value").first().text());
    if (!value) return;
    if (label.includes("cover date")) detail.coverDate = value;
    else if (label.includes("upc")) detail.upc = value;
    else if (label.includes("isbn")) detail.isbn = value;
    else if (label.includes("distributor")) detail.sku = value;
    else if (label.includes("final order")) detail.foc = value;
  });

  // Creators: a .role label paired with the .name link in the same column. This
  // covers interior credits plus the top-level Cover Artists / Production blocks.
  const creators = [];
  $(".role").each(function () {
    const role = clean($(this).text());
    const link = $(this).parent().find(".name a").first();
    const name = clean(link.text());
    if (role && name) creators.push({ name, role, url: absUrl(link.attr("href")) });
  });
  if (creators.length) detail.creators = dedupeCreators(creators);

  // Characters: a .character-type label (Main/Supporting) + the character link.
  const characters = [];
  $(".character-type").each(function () {
    const type = clean($(this).text()) || null;
    const link = $(this).parent().find(".name a").first();
    const name = clean(link.text());
    if (name) characters.push({ name, type, url: absUrl(link.attr("href")) });
  });
  if (characters.length) detail.characters = dedupeCharacters(characters);

  const universe = $("a[href^='/universe/']").first();
  if (universe.length) detail.setting = clean(universe.text());

  const stories = [];
  $("#stories .story-item").each(function () {
    const title = clean($(this).find(".story-title").first().text()) || null;
    const meta = $(this).find(".story-summary .copy-really-small").first().text();
    const m = meta && meta.match(/(\d+)\s*pages/i);
    stories.push({ title, pages: m ? parseInt(m[1], 10) : null });
  });
  if (stories.length) detail.stories = stories;

  return detail;
}

// ── FlareSolverr + orchestration ─────────────────────────────────────────────

async function solveGet(url) {
  let response;
  try {
    response = await fetch(`${FLARESOLVERR_URL}/v1`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cmd: "request.get", url, maxTimeout: FLARESOLVERR_TIMEOUT }),
    });
  } catch (err) {
    throw new Error(`Cannot reach FlareSolverr at ${FLARESOLVERR_URL}: ${err.message}`);
  }

  if (!response.ok) {
    throw new Error(`FlareSolverr returned ${response.status}`);
  }

  const payload = await response.json();
  if (payload.status !== "ok" || !payload.solution) {
    throw new Error(`FlareSolverr failed: ${payload.message || "unknown error"}`);
  }

  const upstreamStatus = payload.solution.status;
  if (upstreamStatus >= 400) {
    throw new Error(`LOCG returned ${upstreamStatus}`);
  }

  return payload.solution.response || "";
}

// FlareSolverr returns the page as rendered in a browser, so a JSON endpoint
// comes back wrapped in <html>…<pre>{json}</pre>…</html>. Recover the JSON.
function parseSolvedJson(html) {
  const trimmed = (html || "").trim();

  try {
    return JSON.parse(trimmed);
  } catch (_) { /* fall through */ }

  const $ = cheerio.load(html);
  const text = ($("pre").first().text() || $("body").text() || "").trim();
  try {
    return JSON.parse(text);
  } catch (_) { /* fall through */ }

  const match = text.match(/\{[\s\S]*\}/);
  if (match) {
    return JSON.parse(match[0]);
  }

  throw new Error("Could not parse JSON from FlareSolverr response");
}

// Run an async mapper over items with a bounded number of in-flight tasks.
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await fn(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function enrichComic(comic) {
  const cached = detailCache.get(comic.id);
  if (cached && cached.expires > Date.now()) {
    return { ...comic, ...cached.data };
  }

  const detailUrl = `${ROOT_URL}/comic/${comic.id}/${comic.slug || "comic"}`;
  try {
    const detail = parseDetail(await solveGet(detailUrl));
    detailCache.set(comic.id, { data: detail, expires: Date.now() + DETAIL_TTL_MS });
    return { ...comic, ...detail };
  } catch (err) {
    // Degrade gracefully: keep the list-level fields if the page can't be read.
    console.error(`Detail enrich failed for comic ${comic.id}: ${err.message}`);
    return comic;
  }
}

async function fetchComics(date, publisherIds, { details = true } = {}) {
  const params = new URLSearchParams({
    list: "releases",
    list_option: "issue",
    view: "list",
    date_type: "week",
    date: date,
    order: "pulls",
  });

  if (publisherIds && publisherIds.length > 0) {
    publisherIds.forEach((id) => params.append("publisher[]", id));
  }

  const url = `${ROOT_URL}/comic/get_comics?${params.toString()}`;
  const data = parseSolvedJson(await solveGet(url));

  if (!data || typeof data.list !== "string") {
    throw new Error("Unexpected response format from LOCG");
  }

  const comics = parseReleases(data.list);
  if (!details) return comics;
  return mapLimit(comics, DETAIL_CONCURRENCY, enrichComic);
}

function wantsDetails(req) {
  return req.query.details !== "false";
}

function resolvePublishers(param) {
  const ids = [];
  for (const raw of (param || "").split(",")) {
    const name = raw.trim().toLowerCase();
    if (!name) continue;
    if (name === "marvel") ids.push(PUBLISHERS["Marvel Comics"]);
    else if (name === "dc") ids.push(PUBLISHERS["DC Comics"]);
    else {
      const entry = Object.entries(PUBLISHERS).find(([k]) => k.toLowerCase() === name);
      if (entry) ids.push(entry[1]);
    }
  }
  return ids;
}

// GET /comics/new?date=2026-06-18&publisher=marvel,dc&details=true
app.get("/comics/new", async (req, res) => {
  try {
    const date = req.query.date || formatDate(getWednesday());
    const comics = await fetchComics(date, resolvePublishers(req.query.publisher), { details: wantsDetails(req) });
    res.json({ date, count: comics.length, comics });
  } catch (err) {
    console.error("Error fetching comics:", err.message);
    res.status(502).json({ error: err.message });
  }
});

// GET /comics/marvel — shortcut for this week's Marvel
app.get("/comics/marvel", async (req, res) => {
  try {
    const date = req.query.date || formatDate(getWednesday());
    const comics = await fetchComics(date, [PUBLISHERS["Marvel Comics"]], { details: wantsDetails(req) });
    res.json({ date, count: comics.length, comics });
  } catch (err) {
    console.error("Error fetching Marvel comics:", err.message);
    res.status(502).json({ error: err.message });
  }
});

// GET /comics/dc — shortcut for this week's DC
app.get("/comics/dc", async (req, res) => {
  try {
    const date = req.query.date || formatDate(getWednesday());
    const comics = await fetchComics(date, [PUBLISHERS["DC Comics"]], { details: wantsDetails(req) });
    res.json({ date, count: comics.length, comics });
  } catch (err) {
    console.error("Error fetching DC comics:", err.message);
    res.status(502).json({ error: err.message });
  }
});

// GET /health
app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Comic API listening on port ${PORT}`);
});
