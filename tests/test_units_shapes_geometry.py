"""Real-world lengths, physical light shapes, and plane geometry."""

import pytest

from myhuey.geometry import distance_to_polygon, point_in_polygon, polygon_area, sample_along
from myhuey.shapes import BAR, COLUMN, ROUND, STRIP, TUBE, light_profile, profile_for
from myhuey.units import format_length, parse_length


@pytest.mark.parametrize(
    "text, expected",
    [
        ("12'6\"", 381.0),
        ("12ft 6in", 381.0),
        ("12 ft", 365.76),
        ("6in", 15.24),
        ("3.5m", 350.0),
        ("380cm", 380.0),
        ("900mm", 90.0),
        ("10", 304.8),  # a bare number is feet for imperial rooms
    ],
)
def test_lengths_parse_to_centimeters(text, expected):
    assert parse_length(text) == pytest.approx(expected)


def test_bare_numbers_are_meters_in_metric_rooms():
    assert parse_length("4.2", "metric") == pytest.approx(420)


@pytest.mark.parametrize("text", ["", "twelve feet", "12 parsecs"])
def test_unreadable_lengths_are_rejected(text):
    with pytest.raises(ValueError):
        parse_length(text)


def test_lengths_format_for_people():
    assert format_length(381) == "12' 6\""
    assert format_length(365.76) == "12'"
    assert format_length(381, "metric") == "3.81 m"
    assert format_length(45, "metric") == "45 cm"


@pytest.mark.parametrize(
    "archetype, product, model, kind, length, gradient",
    [
        ("huelightstrip", "Hue lightstrip plus", "LCL001", STRIP, 200, False),
        ("huelightstrip", "Hue gradient lightstrip", "LCX004", STRIP, 200, True),
        ("huelightstriptv", "Hue play gradient lightstrip", "LCX002", STRIP, 144, True),
        ("hueplay", "Hue Play", "440400982841", BAR, 25.3, False),
        ("huetube", "Play gradient tube", "915005988501", TUBE, 75, True),
        ("huesigne", "Signe gradient floor", "915005987601", COLUMN, 145, True),
        ("huesigne", "Hue Signe table", "4080148U9", COLUMN, 55, False),
        ("sultanbulb", "Hue color lamp", "LCA003", ROUND, 15, False),
        ("spotbulb", "Hue color spot", "LCG001", ROUND, 8, False),
        ("something-new", "Unknown", "X", ROUND, 15, False),
    ],
)
def test_light_shapes_come_from_the_most_specific_clue(archetype, product, model, kind, length, gradient):
    profile = light_profile(archetype, product, model)
    assert (profile.kind, profile.length, profile.gradient) == (kind, length, gradient)


def test_lightstrips_are_adjustable_and_bars_are_not():
    assert light_profile("huelightstrip").adjustable
    assert not light_profile("hueplay").adjustable


def test_the_v2_gradient_count_overrides_the_table():
    raw = {"config": {"archetype": "huelightstrip"}, "productname": "Hue lightstrip plus", "modelid": "LCL001"}
    assert profile_for(raw, gradient_points=5).gradient is True
    assert profile_for(raw, gradient_points=0).gradient is False


SQUARE = [(0, 0), (100, 0), (100, 100), (0, 100)]
L_SHAPE = [(0, 0), (200, 0), (200, 100), (100, 100), (100, 200), (0, 200)]


def test_point_in_polygon_handles_concave_rooms():
    assert point_in_polygon((50, 50), SQUARE)
    assert not point_in_polygon((150, 50), SQUARE)
    assert point_in_polygon((50, 150), L_SHAPE)
    assert not point_in_polygon((150, 150), L_SHAPE)  # the notch of the L


def test_polygon_area_and_distance():
    assert polygon_area(L_SHAPE) == 30000
    assert distance_to_polygon((50, 50), SQUARE) == 0
    assert distance_to_polygon((130, 50), SQUARE) == pytest.approx(30)


def test_samples_run_start_to_end_along_the_rotation():
    assert sample_along((100, 100), 0, 200, 3) == [(0, 100), (100, 100), (200, 100)]
    vertical = sample_along((0, 0), 90, 100, 2)
    assert vertical[0] == pytest.approx((0, -50)) and vertical[1] == pytest.approx((0, 50))
    assert sample_along((5, 5), 0, 100, 1) == [(5, 5)]
