// Minimal Node consumer for locg-api (Node 18+, uses the built-in fetch).
//
// Start the API first (`docker compose up -d`), then:
//   node examples/fetch.js marvel
//   node examples/fetch.js dc http://localhost:8070

const publisher = process.argv[2] || "marvel";
const baseUrl = process.argv[3] || "http://localhost:8070";

async function main() {
  const res = await fetch(`${baseUrl}/comics/${publisher}`);
  if (!res.ok) {
    throw new Error(`locg-api returned ${res.status}`);
  }

  const { date, count, comics } = await res.json();
  console.log(`${count} ${publisher} release(s) for the week of ${date}\n`);

  for (const comic of comics) {
    const variants = comic.variantCount ? ` (+${comic.variantCount} variants)` : "";
    console.log(`• ${comic.title} — ${comic.price || "?"}${variants}`);
  }

  // Full detail of the top-pulled book.
  const top = comics[0];
  if (top) {
    const writers = (top.creators || [])
      .filter((c) => c.role === "Writer")
      .map((c) => c.name)
      .join(", ");
    console.log(`\nTop pull: ${top.title}`);
    if (writers) console.log(`  Writer: ${writers}`);
    if (top.pages) console.log(`  Pages: ${top.pages}`);
    console.log(`  Characters: ${(top.characters || []).length} · Variants: ${top.variantCount}`);
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
