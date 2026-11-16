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


def test_every_colourlovers_entry_has_author_and_url():
    for palette in load():
        if palette.source == "colourlovers":
            assert palette.credit.get("author") and palette.credit.get("url", "").startswith("http")
        if palette.source == "met":
            assert palette.credit.get("title") and palette.credit.get("url", "").startswith("http")


def test_license_file_ships():
    from importlib import resources

    text = resources.files("myhuey.data").joinpath("PALETTES_LICENSE.md").read_text(encoding="utf-8")
    assert "CC BY-NC-SA 3.0" in text and "CC0" in text


def test_met_credit_titles_are_not_cut_mid_word():
    # The build once cut titles at 60 characters; full titles were fetched again, or cut at a word with "…".
    for palette in load():
        if palette.source == "met":
            title = palette.credit["title"]
            assert len(title) != 60 or title.endswith("…"), palette.id
            assert palette.name.endswith(f"({palette.id.rsplit('-', 1)[1]})")


D3_SEQUENTIAL = {
    "Blues", "Greens", "Greys", "Oranges", "Purples", "Reds",
    "BuGn", "BuPu", "GnBu", "OrRd", "PuBuGn", "PuBu", "PuRd", "RdPu", "YlGnBu", "YlGn", "YlOrBr", "YlOrRd",
    "Turbo", "Viridis", "Inferno", "Magma", "Plasma", "Cividis", "Warm", "Cool", "CubehelixDefault",
}


def _brownish(palette):
    from myhuey.palettes import chroma, hue, lab

    values = [lab(color) for color in palette.colors]
    mean_chroma = sum(chroma(v) for v in values) / len(values)
    warm = sum(1 for v in values if chroma(v) > 0.02 and 30 <= hue(v) <= 95) / len(values)
    return mean_chroma < 0.09 and warm >= 0.6


def test_every_d3_sequential_scheme_ships_with_credit():
    d3 = [p for p in load() if p.source == "d3"]
    assert {p.credit.get("scheme") for p in d3} == D3_SEQUENTIAL
    assert all(p.credit.get("license") and p.credit.get("by") and p.id.startswith("d3-") for p in d3)


def test_the_library_is_not_mostly_brown_any_more():
    palettes = load()
    assert sum(_brownish(p) for p in palettes) <= 0.2 * len(palettes)
    assert sum("vivid" in p.tags for p in palettes) >= 60
