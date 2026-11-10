"""Record each station's possible destinations per direction in ``stations.json``.

For the split-flap departure board (``flapboard.js``) the 開往 flap of a
station only carries the terminal stations that trains stopping at that
station, in that direction, actually run to. This script reads the daily
timetables of the last ``DAYS`` days from the TRA_Visualization repository
and writes two fields into every station entry of ``stations.json``:

* ``CWDest``  -- terminals of 順行 trains stopping here
* ``CCWDest`` -- terminals of 逆行 trains stopping here

(the station itself is included when trains of that direction terminate there).

Direction: even train numbers are 順行, odd ones 逆行, except trains via
成追線 at the 山線 stations 成功～苗栗 (``CHENGZHUI_REVERSED_STATIONS``),
where their direction is reversed -- the same rule as ``isClockwiseAtStation``
in ``main.js``.

Ordering (nearest first): each list is sorted by route distance from the
station to the terminal, so train type (stopping pattern, speed) does not
affect the order.

1. Hop lengths. Every pair of consecutive stops seen in any train is a hop.
   Hops are processed from the shortest great-circle length (from the
   ``gps`` field) upwards; a hop that skips stations -- some path of shorter,
   already processed hops joins its ends within ``DETOUR_RATIO`` times its
   straight-line length -- gets that path's length instead. An express hop is
   thus measured through the stations it passes, like a local train.
2. Route distance. For one train, the distance from station s to its
   terminal is the sum of its hop lengths from s onwards, minimised over all
   trains running from s to that terminal.
3. Network distance. Per direction, the hops of that direction's trains form
   a directed graph; a station terminal's distance is the smaller of its
   route distance and its shortest path from s (Dijkstra). Using only one
   direction's trains keeps the ring orientation, and the shortest path makes
   "nearest" independent of which line a particular train took (e.g. 山線 vs
   海線). Terminals that are not stations (the round-the-island 臺北環島)
   keep their route distance.

Usage::

    python scripts/build_station_destinations.py [--days 7]

Complexity: O(D * T * S) time to read D days of T trains with S stops each,
plus O(H * (H + N) log N) for the hop lengths (H distinct hops, N stations,
one bounded Dijkstra search per hop); O(D * T * S) space for the timetables.
"""

from __future__ import annotations

import argparse
import datetime as dt
import heapq
import json
import math
import urllib.error
import urllib.request
from collections import defaultdict
from pathlib import Path
from typing import Any

DAYS: int = 7
SCHEDULE_URL: str = (
    "https://raw.githubusercontent.com/4960fh7/TRA_Visualization/main/"
    "data_new/{date}.json"
)
STATIONS_PATH: Path = Path(__file__).resolve().parent.parent / "stations.json"
EARTH_RADIUS_KM: float = 6371.0
# A hop counts as skipping stations when shorter hops join its ends within
# this factor of its straight-line length. Winding lines need headroom: the
# 宜蘭線 runs about 2.4x the straight line between 臺北 and 宜蘭.
DETOUR_RATIO: float = 3.0
# 成追線 trains: even = 臺中→大甲, odd = 大甲→臺中, which on the 山線 stations
# 成功～苗栗 is the opposite of the station's direction. Keep in sync with
# CHENGZHUI_REVERSED_STATIONS in main.js.
CHENGZHUI_VIA: str = "成追線"
CHENGZHUI_REVERSED_STATIONS: frozenset[str] = frozenset({
    "成功", "新烏日", "烏日", "大慶", "五權", "臺中", "精武", "太原", "松竹", "頭家厝",
    "潭子", "栗林", "豐原", "后里", "泰安", "三義", "銅鑼", "南勢", "苗栗",
})

Coordinates = dict[str, tuple[float, float]]
Hop = frozenset[str]
Graph = dict[str, list[tuple[str, float]]]
# (station name, direction key) -> destination name -> shortest route km
RouteDistances = dict[tuple[str, str], dict[str, float]]


def clean_destination(end_field: str) -> str:
    """Return the station name of an ``info.end`` field ("HH:MM 站名").

    Mirrors ``cleanDestination`` in ``flapboard.js``.
    """
    name = end_field[6:] if len(end_field) > 6 else end_field
    return name.replace("_", "")


def haversine_km(a: tuple[float, float], b: tuple[float, float]) -> float:
    """Great-circle distance in km between two (lat, lon) points in degrees."""
    lat1, lon1, lat2, lon2 = map(math.radians, (*a, *b))
    h = (math.sin((lat2 - lat1) / 2) ** 2
         + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2)
    return 2 * EARTH_RADIUS_KM * math.asin(math.sqrt(h))


def station_coordinates(stations: list[dict[str, Any]]) -> Coordinates:
    """Map station name -> (lat, lon) from the ``gps`` field ("lat lon")."""
    coords: Coordinates = {}
    for station in stations:
        try:
            lat, lon = (float(v) for v in station["gps"].split())
        except (KeyError, ValueError):
            continue
        coords[station["stationName"]] = (lat, lon)
    return coords


def fetch_schedule(date: dt.date) -> list[dict[str, Any]] | None:
    """Download one day's timetable, or ``None`` if it does not exist."""
    url = SCHEDULE_URL.format(date=date.strftime("%Y%m%d"))
    try:
        with urllib.request.urlopen(url, timeout=60) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        if error.code == 404:
            return None
        raise


def stop_names(train: dict[str, Any], coords: Coordinates) -> list[str]:
    """A train's stops that have coordinates, consecutive repeats merged."""
    names: list[str] = []
    for stop in train.get("data") or []:
        name = stop["x"]
        if name in coords and (not names or names[-1] != name):
            names.append(name)
    return names


def shortest_path_km(graph: Graph, source: str, target: str, cutoff: float) -> float | None:
    """Dijkstra distance from ``source`` to ``target``, or None if above ``cutoff``."""
    best = {source: 0.0}
    heap = [(0.0, source)]
    while heap:
        dist, node = heapq.heappop(heap)
        if node == target:
            return dist
        if dist > best.get(node, math.inf):
            continue
        for neighbour, length in graph.get(node, ()):
            candidate = dist + length
            if candidate <= cutoff and candidate < best.get(neighbour, math.inf):
                best[neighbour] = candidate
                heapq.heappush(heap, (candidate, neighbour))
    return None


def hop_lengths(trains: list[dict[str, Any]], coords: Coordinates) -> dict[Hop, float]:
    """Length in km of every hop, measured through the stations it skips.

    Hops are added to an undirected station graph in increasing straight-line
    length; a hop whose ends are already joined by a path no longer than
    ``DETOUR_RATIO`` times its straight-line length takes that path's length.
    """
    chords: dict[Hop, float] = {}
    for train in trains:
        names = stop_names(train, coords)
        for a, b in zip(names, names[1:]):
            hop = frozenset((a, b))
            if hop not in chords:
                chords[hop] = haversine_km(coords[a], coords[b])

    graph: Graph = defaultdict(list)
    lengths: dict[Hop, float] = {}
    for hop, chord in sorted(chords.items(), key=lambda item: (item[1], sorted(item[0]))):
        a, b = sorted(hop)
        detour = shortest_path_km(graph, a, b, DETOUR_RATIO * chord)
        length = detour if detour is not None else chord
        lengths[hop] = length
        graph[a].append((b, length))
        graph[b].append((a, length))
    return lengths


def route_distances(
    trains: list[dict[str, Any]], coords: Coordinates, lengths: dict[Hop, float]
) -> RouteDistances:
    """Shortest route distance from every station to each terminal, per direction.

    Every station a train stops at counts, including its terminal (distance
    0), because the board also shows trains ending at the selected station.
    """
    out: RouteDistances = defaultdict(dict)
    for train in trains:
        info = train.get("info") or {}
        names = stop_names(train, coords)
        if len(names) < 2 or not info.get("end") or direction_at(train, names[0]) is None:
            continue
        destination = clean_destination(info["end"])

        # Distance still to run from each stop to the terminal, accumulated
        # backwards; the last occurrence of a station is where the train
        # leaves it (a ring train may pass a station twice).
        remaining = 0.0
        seen: set[str] = set()
        for i in range(len(names) - 1, -1, -1):
            if i < len(names) - 1:
                remaining += lengths[frozenset((names[i], names[i + 1]))]
            station = names[i]
            if station in seen:
                continue
            seen.add(station)
            by_dest = out[(station, direction_at(train, station))]
            if remaining < by_dest.get(destination, math.inf):
                by_dest[destination] = remaining
    return out


def direction_at(train: dict[str, Any], station: str) -> str | None:
    """'CW' (順行) or 'CCW' (逆行) of a train at ``station``; None without a number.

    Even numbers are 順行 and odd ones 逆行, reversed for 成追線 trains at the
    山線 stations in ``CHENGZHUI_REVERSED_STATIONS``.
    """
    try:
        is_even = int(train.get("number")) % 2 == 0
    except (TypeError, ValueError):
        return None
    info = train.get("info") or {}
    if info.get("via") == CHENGZHUI_VIA and station in CHENGZHUI_REVERSED_STATIONS:
        is_even = not is_even
    return "CW" if is_even else "CCW"


def directed_graphs(
    trains: list[dict[str, Any]], coords: Coordinates, lengths: dict[Hop, float]
) -> dict[str, Graph]:
    """One directed hop graph per direction; a hop belongs to the direction
    the train has at the station the hop starts from."""
    graphs: dict[str, dict[str, dict[str, float]]] = {"CW": defaultdict(dict), "CCW": defaultdict(dict)}
    for train in trains:
        names = stop_names(train, coords)
        for a, b in zip(names, names[1:]):
            direction = direction_at(train, a)
            if direction is None:
                break
            graphs[direction][a][b] = lengths[frozenset((a, b))]
    return {d: {a: list(nbrs.items()) for a, nbrs in g.items()} for d, g in graphs.items()}


def all_distances_km(graph: Graph, source: str) -> dict[str, float]:
    """Dijkstra distances from ``source`` to every reachable station."""
    best = {source: 0.0}
    heap = [(0.0, source)]
    while heap:
        dist, node = heapq.heappop(heap)
        if dist > best[node]:
            continue
        for neighbour, length in graph.get(node, ()):
            candidate = dist + length
            if candidate < best.get(neighbour, math.inf):
                best[neighbour] = candidate
                heapq.heappush(heap, (candidate, neighbour))
    return best


def network_distances(
    route: RouteDistances, graphs: dict[str, Graph], coords: Coordinates
) -> RouteDistances:
    """Shorten route distances of station terminals to network shortest paths.

    The minimum of both is kept: a 成追線 train changes direction on the way,
    so its own route can be far shorter than any one-direction network path
    (which would have to go round the island).
    """
    out: RouteDistances = {}
    for (station, direction), by_dest in route.items():
        reach = all_distances_km(graphs[direction], station)
        out[(station, direction)] = {
            dest: (min(dist, reach.get(dest, math.inf)) if dest in coords else dist)
            for dest, dist in by_dest.items()
        }
    return out


def ordered_destinations(distances: dict[str, float]) -> list[str]:
    """Destinations sorted by route distance (nearest first), then name."""
    return sorted(distances, key=lambda name: (distances[name], name))


def main() -> None:
    """Fetch the timetables and update ``stations.json`` in place."""
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--days", type=int, default=DAYS, help="days to read (default 7)")
    args = parser.parse_args()

    stations: list[dict[str, Any]] = json.loads(STATIONS_PATH.read_text(encoding="utf-8"))
    coords = station_coordinates(stations)

    all_trains: list[dict[str, Any]] = []
    today = dt.date.today()
    used_days = 0
    for offset in range(args.days):
        date = today - dt.timedelta(days=offset)
        trains = fetch_schedule(date)
        if trains is None:
            print(f"{date}: no timetable, skipped")
            continue
        all_trains.extend(trains)
        used_days += 1
        print(f"{date}: {len(trains)} trains")
    if used_days == 0:
        raise SystemExit("No timetable could be downloaded; stations.json unchanged.")

    lengths = hop_lengths(all_trains, coords)
    distances = network_distances(
        route_distances(all_trains, coords, lengths),
        directed_graphs(all_trains, coords, lengths),
        coords,
    )
    for station in stations:
        name = station["stationName"]
        station["CWDest"] = ordered_destinations(distances.get((name, "CW"), {}))
        station["CCWDest"] = ordered_destinations(distances.get((name, "CCW"), {}))

    # Same layout as the existing file: 4-space indent, no trailing newline.
    STATIONS_PATH.write_text(
        json.dumps(stations, ensure_ascii=False, indent=4), encoding="utf-8"
    )
    print(f"Updated {len(stations)} stations from {used_days} day(s) of timetables.")


if __name__ == "__main__":
    main()
