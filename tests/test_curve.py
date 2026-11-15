from datetime import time

from myhuey.curve import baseline, minutes_until_bed

W, B = "07:00", "23:00"


def test_anchor_points():
    assert baseline(time(7, 0), W, B) == (3000, 60)
    assert baseline(time(12, 0), W, B) == (5000, 100)
    assert baseline(time(21, 0), W, B) == (3000, 70)
    assert baseline(time(23, 0), W, B) == (2400, 40)
    assert baseline(time(3, 0), W, B) == (2200, 25)


def test_interpolates_in_mirek():
    kelvin, brightness = baseline(time(7, 30), W, B)
    assert kelvin == round(1e6 / ((1e6 / 3000 + 1e6 / 5000) / 2))
    assert brightness == 80


def test_reaches_the_night_level_an_hour_after_bed():
    assert baseline(time(0, 0), W, B) == (2200, 25)
    assert 2200 < baseline(time(23, 30), W, B)[0] < 2400


def test_curve_wraps_past_midnight():
    assert 2400 < baseline(time(0, 30), "09:00", "01:30")[0] < 3000  # wind-down, not after bed
    assert baseline(time(3, 0), "09:00", "01:30") == (2200, 25)


def test_a_short_day_keeps_its_anchors_in_order():
    kelvin, _ = baseline(time(9, 0), "07:00", "10:00")
    assert 2400 <= kelvin <= 5000


def test_minutes_until_bed():
    assert minutes_until_bed(time(21, 0), W, B) == 120
    assert minutes_until_bed(time(1, 0), W, B) is None
    assert minutes_until_bed(time(8, 0), W, B) == 900
