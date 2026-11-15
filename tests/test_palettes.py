"""The palette library: tags, filtering for room light, generated harmonies, the shipped file."""

from myhuey.palettes import generate, load, search, tag, usable


def test_tags():
    assert "warm" in tag(["#c8553d", "#f28f3b", "#ffd5c2"])
    assert "blue_heavy" in tag(["#1d3557", "#457b9d", "#a8dadc"])
    assert "cool" in tag(["#1d3557", "#457b9d", "#a8dadc"])
    assert "muted" in tag(["#8a817c", "#bcb8b1", "#a39e93"])


def test_unusable_palettes_are_rejected():
    assert not usable(["#000000", "#050505", "#ff00ff"])  # fewer than 3 colors left after near-black and neon
    assert usable(["#c8553d", "#f28f3b", "#ffd5c2", "#588b8b"])


def test_harsh_complements_are_rejected():
    assert not usable(["#b03aa0", "#5fa800", "#f1faee"])  # saturated magenta against saturated green: opposite in OKLab


def test_generate_is_deterministic_and_usable():
    first = generate(1, 20)
    assert first == generate(1, 20)
    assert len(first) == 20
    assert all(usable(p.colors) for p in first)
    assert len({p.id for p in first}) == 20


def test_generated_cover_relax_tags():
    tags = {t for p in generate(0, 200) for t in p.tags}
    assert {"vivid", "accent", "warm", "muted"} <= tags


def test_load_reads_packaged_json():
    palettes = load()
    assert len(palettes) >= 100
    assert all(p.credit or p.source == "generated" for p in palettes)


def test_search_by_tag_and_text():
    warm = search(tag="warm", limit=500)
    assert warm and all("warm" in p.tags for p in warm)
    named = load()[0].name.split()[0]
    assert all(named.lower() in p.name.lower() for p in search(q=named, limit=500))
