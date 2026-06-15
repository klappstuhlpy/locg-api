"""Minimal Python client for locg-api using only the standard library + dataclasses.

Start the API first (``docker compose up -d``), then::

    python examples/client.py marvel
    python examples/client.py dc http://localhost:8070
"""

from __future__ import annotations

import json
import sys
from dataclasses import dataclass, field
from urllib.parse import urlencode
from urllib.request import urlopen


@dataclass
class Variant:
    """A variant cover folded into its base issue."""

    id: str
    name: str
    cover: str | None = None
    url: str | None = None
    price: str | None = None


@dataclass
class Creator:
    name: str
    role: str
    url: str | None = None


@dataclass
class Character:
    name: str
    type: str | None = None  # "Main" | "Supporting" | "Cameo"
    url: str | None = None


@dataclass
class Story:
    title: str | None = None
    pages: int | None = None


@dataclass
class Comic:
    """A base issue. Enriched fields are populated when ``details=true`` (the default)."""

    id: str
    title: str
    url: str | None = None
    cover: str | None = None
    publisher: str | None = None
    price: str | None = None
    release_date: str | None = None
    pulls: int = 0
    rating: float | None = None  # community consensus %
    sku: str | None = None
    foc: str | None = None
    # ── enriched (details=true) ──
    description: str | None = None
    format: str | None = None
    pages: int | None = None
    cover_date: str | None = None
    upc: str | None = None
    isbn: str | None = None
    setting: str | None = None
    variant_count: int = 0
    creators: list[Creator] = field(default_factory=list)
    characters: list[Character] = field(default_factory=list)
    stories: list[Story] = field(default_factory=list)
    variants: list[Variant] = field(default_factory=list)

    @classmethod
    def from_json(cls, data: dict) -> Comic:
        return cls(
            id=str(data.get("id")),
            title=data.get("title") or "",
            url=data.get("url"),
            cover=data.get("cover"),
            publisher=data.get("publisher"),
            price=data.get("price"),
            release_date=data.get("releaseDate"),
            pulls=data.get("pulls") or 0,
            rating=data.get("rating"),
            sku=data.get("sku"),
            foc=data.get("foc"),
            description=data.get("description"),
            format=data.get("format"),
            pages=data.get("pages"),
            cover_date=data.get("coverDate"),
            upc=data.get("upc"),
            isbn=data.get("isbn"),
            setting=data.get("setting"),
            variant_count=data.get("variantCount") or 0,
            creators=[Creator(**c) for c in data.get("creators") or []],
            characters=[Character(**c) for c in data.get("characters") or []],
            stories=[Story(**s) for s in data.get("stories") or []],
            variants=[Variant(**v) for v in data.get("variants") or []],
        )


def fetch_releases(
    publisher: str = "marvel",
    *,
    base_url: str = "http://localhost:8070",
    details: bool = True,
) -> list[Comic]:
    """Fetch this week's releases for ``publisher`` (``"marvel"`` or ``"dc"``)."""
    query = urlencode({"details": str(details).lower()})
    with urlopen(f"{base_url}/comics/{publisher}?{query}", timeout=120) as resp:  # noqa: S310
        payload = json.load(resp)
    return [Comic.from_json(c) for c in payload.get("comics", [])]


def main() -> None:
    publisher = sys.argv[1] if len(sys.argv) > 1 else "marvel"
    base_url = sys.argv[2] if len(sys.argv) > 2 else "http://localhost:8070"

    comics = fetch_releases(publisher, base_url=base_url)
    print(f"{len(comics)} {publisher} release(s)\n")

    for comic in comics:
        extra = f" (+{comic.variant_count} variants)" if comic.variant_count else ""
        print(f"• {comic.title} — {comic.price or '?'}{extra}")

    if comics:
        top = comics[0]
        writers = ", ".join(c.name for c in top.creators if c.role == "Writer")
        print(f"\nTop pull: {top.title}")
        if writers:
            print(f"  Writer: {writers}")
        if top.pages:
            print(f"  Pages: {top.pages}")
        print(f"  Characters: {len(top.characters)} · Variants: {top.variant_count}")


if __name__ == "__main__":
    main()
