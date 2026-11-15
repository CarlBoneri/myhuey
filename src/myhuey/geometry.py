"""Plane geometry for room outlines, zones, and light positions. Units are centimeters."""

from __future__ import annotations

import math
from typing import Iterable, Sequence

Point = tuple[float, float]


def as_points(raw: Iterable[Sequence[float]]) -> list[Point]:
    return [(float(item[0]), float(item[1])) for item in raw]


def bounds(points: Sequence[Point]) -> tuple[float, float, float, float]:
    """(min_x, min_y, max_x, max_y)"""
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    return min(xs), min(ys), max(xs), max(ys)


def polygon_area(points: Sequence[Point]) -> float:
    area = 0.0
    for (x1, y1), (x2, y2) in zip(points, points[1:] + points[:1]):
        area += x1 * y2 - x2 * y1
    return abs(area) / 2


def point_in_polygon(point: Point, polygon: Sequence[Point]) -> bool:
    """Even-odd ray casting. Points exactly on an edge may land either way."""
    x, y = point
    inside = False
    count = len(polygon)
    for index in range(count):
        x1, y1 = polygon[index]
        x2, y2 = polygon[(index + 1) % count]
        if (y1 > y) != (y2 > y):
            crossing = x1 + (y - y1) * (x2 - x1) / (y2 - y1)
            if x < crossing:
                inside = not inside
    return inside


def distance_to_segment(point: Point, a: Point, b: Point) -> float:
    px, py = point
    ax, ay = a
    bx, by = b
    dx, dy = bx - ax, by - ay
    length_sq = dx * dx + dy * dy
    t = 0.0 if length_sq == 0 else max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / length_sq))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def distance_to_polygon(point: Point, polygon: Sequence[Point]) -> float:
    """0 inside the polygon, otherwise the distance to its nearest edge."""
    if point_in_polygon(point, polygon):
        return 0.0
    return min(distance_to_segment(point, a, b) for a, b in zip(polygon, polygon[1:] + polygon[:1]))


def sample_along(center: Point, rotation_deg: float, length: float, count: int) -> list[Point]:
    """`count` evenly spaced points along a segment centered on `center`, start to end.

    The segment runs along `rotation_deg` (0 points along +x, 90 along +y, as on screen).
    One point is the center itself.
    """
    if count <= 1 or length <= 0:
        return [center]
    angle = math.radians(rotation_deg)
    ux, uy = math.cos(angle), math.sin(angle)
    start = (center[0] - ux * length / 2, center[1] - uy * length / 2)
    step = length / (count - 1)
    return [(start[0] + ux * step * index, start[1] + uy * step * index) for index in range(count)]


def rectangle(width: float, height: float, x: float = 0.0, y: float = 0.0) -> list[Point]:
    return [(x, y), (x + width, y), (x + width, y + height), (x, y + height)]
