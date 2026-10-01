"""Reads a GPX or FIT file and computes the session metrics shown on the card."""

import io
import math
import os

import fitparse
import gpxpy

EARTH_RADIUS_M = 6371000.0
FIT_SEMICIRCLE_TO_DEGREE = 180.0 / (2 ** 31)
ALL_FIELDS = ["distance", "time", "pace", "speed", "elevation", "hr"]


class ActivityError(ValueError):
    """Raised when a file cannot be read as an activity."""


def load_activity(path):
    with open(path, "rb") as fh:
        data = fh.read()
    parse = parse_fit if path.lower().endswith(".fit") else parse_gpx
    activity = parse(data)
    activity["filename"] = os.path.basename(path)
    return activity


def haversine(lat1, lon1, lat2, lon2):
    """Distance in metres between two coordinates."""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlmb = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlmb / 2) ** 2
    return 2 * EARTH_RADIUS_M * math.asin(math.sqrt(a))


def sport_from_text(raw):
    raw = (raw or "").lower()
    if any(k in raw for k in ("run", "carrera", "correr", "jog")):
        return "run"
    if any(k in raw for k in ("ride", "cycl", "bike", "bici")):
        return "ride"
    if any(k in raw for k in ("hike", "trail", "mountain", "monte", "sender", "trek")):
        return "hike"
    if any(k in raw for k in ("walk", "andar", "camin")):
        return "walk"
    return "other"


def _heart_rate(point):
    for ext in point.extensions or []:
        for el in ext.iter():
            if isinstance(el.tag, str) and el.tag.rsplit("}", 1)[-1].lower() in ("hr", "heartrate"):
                try:
                    return float(el.text)
                except (TypeError, ValueError):
                    pass
    return None


def _build_activity(sport_raw, points, eles, times, hrs):
    """Shared metric computation for both GPX and FIT sources.

    points: list of [lat, lon] in degrees. eles: elevations in metres.
    times: datetime objects. hrs: heart rate samples in bpm.
    """
    if len(points) < 2:
        raise ActivityError("The file does not contain enough track points.")

    distance_m = sum(haversine(a[0], a[1], b[0], b[1]) for a, b in zip(points, points[1:]))

    elev_gain = sum(max(0.0, b - a) for a, b in zip(eles, eles[1:])) if len(eles) >= 2 else None

    elapsed_s = (times[-1] - times[0]).total_seconds() if len(times) >= 2 else None
    if elapsed_s is not None and elapsed_s <= 0:
        elapsed_s = None

    pace = speed = None
    if elapsed_s and distance_m > 0:
        pace = elapsed_s / (distance_m / 1000.0)
        speed = (distance_m / 1000.0) / (elapsed_s / 3600.0)

    activity = {
        "sport": sport_from_text(sport_raw),
        "points": points,
        "distance_m": distance_m,
        "elapsed_s": elapsed_s,
        "pace_s_per_km": pace,
        "speed_kmh": speed,
        "elev_gain_m": elev_gain,
        "avg_hr": sum(hrs) / len(hrs) if hrs else None,
    }
    has = {"distance": True, "time": elapsed_s is not None, "pace": pace is not None,
           "speed": speed is not None, "elevation": elev_gain is not None, "hr": bool(hrs)}
    activity["available"] = [f for f in ALL_FIELDS if has[f]]
    return activity


def parse_gpx(data):
    try:
        gpx = gpxpy.parse(data.decode("utf-8-sig", errors="replace"))
    except Exception as exc:
        raise ActivityError(f"Not a valid GPX file: {exc}") from exc

    points = [p for t in gpx.tracks for s in t.segments for p in s.points]
    points = points or [p for r in gpx.routes for p in r.points]  # routes saved as <rte>

    coords = [[p.latitude, p.longitude] for p in points]
    eles = [p.elevation for p in points if p.elevation is not None]
    times = [p.time for p in points if p.time is not None]
    hrs = [h for h in (_heart_rate(p) for p in points) if h]
    sport_raw = next((t.type for t in gpx.tracks if t.type), "")

    return _build_activity(sport_raw, coords, eles, times, hrs)


def parse_fit(data):
    points, eles, times, hrs, sport_raw = [], [], [], [], ""
    try:
        fit = fitparse.FitFile(io.BytesIO(data))
        for msg in fit.get_messages("record"):
            lat = msg.get_value("position_lat")
            lon = msg.get_value("position_long")
            if lat is not None and lon is not None:
                points.append([lat * FIT_SEMICIRCLE_TO_DEGREE, lon * FIT_SEMICIRCLE_TO_DEGREE])
            ele = msg.get_value("enhanced_altitude")
            if ele is None:
                ele = msg.get_value("altitude")
            if ele is not None:
                eles.append(ele)
            ts = msg.get_value("timestamp")
            if ts is not None:
                times.append(ts)
            hr = msg.get_value("heart_rate")
            if hr:
                hrs.append(hr)
        for msg in fit.get_messages("session"):
            sport_raw = str(msg.get_value("sport") or "")
            break
    except Exception as exc:
        raise ActivityError(f"Not a valid FIT file: {exc}") from exc

    return _build_activity(sport_raw, points, eles, times, hrs)
