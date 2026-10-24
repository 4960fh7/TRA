"""Build ``rail_lines.json`` (GeoJSON) from the NLSC Taiwan railway shapefile.

Data source:
    內政部國土測繪中心「臺灣鐵路」 (https://data.gov.tw/dataset/73220),
    released under the Open Government Data License, version 1.0
    (政府資料開放授權條款-第1版).

Usage:
    python scripts/build_rail_lines.py <RAIL_xxxxxxx.shp> rail_lines.json

Requirements:
    pip install pyshp shapely pyproj

Pipeline (n = number of input vertices):
    1. Keep only TRA passenger lines in service; drop yards, freight spurs,
       the disused Old Mountain Line and the Alishan Forest Railway.
    2. Group segments by display line and merge them with ``linemerge``.
    3. Simplify with Douglas-Peucker in TWD97 / TM2 metres (EPSG:3826),
       then reproject to WGS84 and round to 5 decimals (about 1 m).
    Time is O(n log n) for the merge and expected O(n log n) for the
    simplification; space is O(n).
"""

from __future__ import annotations

import json
import sys
from collections import defaultdict
from pathlib import Path

import shapefile
from pyproj import Transformer
from shapely.geometry import LineString, MultiLineString, mapping
from shapely.ops import linemerge, transform

# Source RAILNAME -> (display name, category). Names not listed are dropped.
LINE_MAP: dict[str, tuple[str, str]] = {
    "臺鐵縱貫線(北段)": ("縱貫線", "main"),
    "臺鐵縱貫線(南段)": ("縱貫線", "main"),
    "臺鐵縱貫線南段": ("縱貫線", "main"),
    "臺鐵臺中線(山線)": ("臺中線（山線）", "main"),
    "臺鐵縱貫線(海線)": ("海岸線（海線）", "main"),
    "臺鐵海岸線(海線)": ("海岸線（海線）", "main"),
    "臺鐵宜蘭線": ("宜蘭線", "main"),
    "臺鐵北迴線": ("北迴線", "main"),
    "臺鐵臺東線": ("臺東線", "main"),
    "臺鐵南迴線": ("南迴線", "main"),
    "臺鐵屏東線": ("屏東線", "main"),
    "臺鐵平溪線": ("平溪線", "branch"),
    "臺鐵深澳線": ("深澳線", "branch"),
    "臺鐵內灣線": ("內灣線", "branch"),
    "臺鐵六家線": ("六家線", "branch"),
    "臺鐵集集線": ("集集線", "branch"),
    "臺鐵沙崙線": ("沙崙線", "branch"),
    "臺鐵成追線": ("成追線", "branch"),
}

SIMPLIFY_TOLERANCE_M = 8.0  # ~1 px at the map's maximum zoom (k = 40)
COORD_PRECISION = 5


def round_coords(geom: LineString | MultiLineString) -> list:
    """Return GeoJSON coordinates rounded to ``COORD_PRECISION`` decimals."""
    coords = mapping(geom)["coordinates"]
    if geom.geom_type == "LineString":
        coords = [coords]
    return [
        [[round(x, COORD_PRECISION), round(y, COORD_PRECISION)] for x, y in part]
        for part in coords
    ]


def build(shp_path: Path) -> dict:
    """Read the shapefile and return a GeoJSON FeatureCollection of TRA lines."""
    reader = shapefile.Reader(str(shp_path), encoding="utf-8")
    to_wgs84 = Transformer.from_crs(3826, 4326, always_xy=True).transform

    groups: dict[tuple[str, str], list[LineString]] = defaultdict(list)
    for shape_rec in reader.iterShapeRecords():
        rec = shape_rec.record
        target = LINE_MAP.get(rec["RAILNAME"])
        # STATUS == 1 marks segments that are out of service.
        if target is None or rec["STATUS"] == 1:
            continue
        shape = shape_rec.shape
        # A polyline may hold several parts; split them by part offsets.
        bounds = list(shape.parts) + [len(shape.points)]
        for start, end in zip(bounds[:-1], bounds[1:]):
            if end - start >= 2:
                groups[target].append(LineString(shape.points[start:end]))

    features = []
    # Main lines first so branches are drawn on top of them.
    for (name, category), parts in sorted(
        groups.items(), key=lambda item: (item[0][1] != "main", item[0][0])
    ):
        merged = linemerge(MultiLineString(parts))
        simplified = merged.simplify(SIMPLIFY_TOLERANCE_M, preserve_topology=False)
        projected = transform(to_wgs84, simplified)
        features.append({
            "type": "Feature",
            "properties": {"name": name, "category": category},
            "geometry": {
                "type": "MultiLineString",
                "coordinates": round_coords(projected),
            },
        })
    return {"type": "FeatureCollection", "features": features}


def main(argv: list[str]) -> int:
    """CLI entry point; returns the process exit code."""
    if len(argv) != 3:
        print(__doc__)
        return 1
    collection = build(Path(argv[1]))
    Path(argv[2]).write_text(
        json.dumps(collection, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    for feature in collection["features"]:
        props = feature["properties"]
        n_pts = sum(len(p) for p in feature["geometry"]["coordinates"])
        print(f"{props['category']:6} {props['name']}: {n_pts} pts")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
