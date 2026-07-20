"""Pure serialization strategies for orbital catalog and ephemeris exports."""

import csv
import datetime
from io import StringIO


# SGP4Propagator converts TEME output into Orbit's Earth-fixed runtime frame
# and returns metres / metres per second. CCSDS OEM data is expressed in km
# and km/s, so OEM export must convert both values and declare the resulting
# frame rather than leaking the propagator's input TEME frame.
_RUNTIME_OEM_REF_FRAME = "ITRF"
_METRES_PER_KILOMETRE = 1000.0


def safe_filename(value: str, fallback: str = "satellite") -> str:
    raw = (value or fallback).strip()
    normalized = "".join(char if char.isalnum() or char in "-_" else "_" for char in raw)
    return normalized or fallback


def normalize_source_format(value: str | None, fallback: str = "TLE") -> str:
    source = str(value or fallback).strip().upper()
    return source if source in {"TLE", "OMM", "OEM"} else fallback


def omm_json_from_entry(entry: dict) -> dict:
    return {
        "OBJECT_NAME": entry.get("name"),
        "OBJECT_ID": entry.get("name"),
        "TLE_LINE1": entry.get("line1"),
        "TLE_LINE2": entry.get("line2"),
    }


def omm_xml_from_entry(entry: dict) -> str:
    name = entry.get("name", "")
    line1 = entry.get("line1", "")
    line2 = entry.get("line2", "")
    return (
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n"
        "<ndm>\n"
        "  <omm version=\"2.0\">\n"
        "    <body>\n"
        "      <segment>\n"
        "        <metadata>\n"
        f"          <OBJECT_NAME>{name}</OBJECT_NAME>\n"
        f"          <OBJECT_ID>{name}</OBJECT_ID>\n"
        "        </metadata>\n"
        "        <data>\n"
        "          <tleParameters>\n"
        f"            <TLE_LINE1>{line1}</TLE_LINE1>\n"
        f"            <TLE_LINE2>{line2}</TLE_LINE2>\n"
        "          </tleParameters>\n"
        "        </data>\n"
        "      </segment>\n"
        "    </body>\n"
        "  </omm>\n"
        "</ndm>\n"
    )


def ocm_json_from_entry(entry: dict) -> dict:
    return {
        "format": "OCM",
        "object": {"name": entry.get("name")},
        "mean_elements_source": {"line1": entry.get("line1"), "line2": entry.get("line2")},
        "generatedAt": datetime.datetime.now(datetime.UTC).isoformat(),
    }


def ephemeris_csv_text(points: list[dict], source_format: str = "TLE", propagator: str = "sgp4") -> str:
    output = StringIO()
    writer = csv.writer(output)
    writer.writerow(["time", "x", "y", "z", "vx", "vy", "vz", "source_format", "propagator"])
    for point in points:
        position = point.get("position") or {}
        velocity = point.get("velocity") or {}
        writer.writerow([
            point.get("time", ""), position.get("x", ""), position.get("y", ""), position.get("z", ""),
            velocity.get("x", ""), velocity.get("y", ""), velocity.get("z", ""), source_format, propagator,
        ])
    return output.getvalue()


def ephemeris_oem_text(
    name: str,
    start_iso: str,
    end_iso: str,
    points: list[dict],
    source_format: str = "TLE",
    propagator: str = "sgp4",
) -> str:
    lines = [
        "CCSDS_OEM_VERS = 2.0",
        f"CREATION_DATE = {datetime.datetime.now(datetime.UTC).isoformat()}",
        "ORIGINATOR = Orbit",
        f"COMMENT = SOURCE_FORMAT {source_format}",
        f"COMMENT = PROPAGATOR {propagator}",
        "META_START", f"OBJECT_NAME = {name}", f"OBJECT_ID = {name}", "CENTER_NAME = EARTH",
        f"REF_FRAME = {_RUNTIME_OEM_REF_FRAME}", "TIME_SYSTEM = UTC", f"START_TIME = {start_iso}", f"STOP_TIME = {end_iso}", "META_STOP",
        "COMMENT = ORBIT_POSITION_UNIT = km",
        "COMMENT = ORBIT_VELOCITY_UNIT = km/s",
    ]
    for point in points:
        position = point.get("position") or {}
        velocity = point.get("velocity") or {}
        x = float(position.get("x", 0)) / _METRES_PER_KILOMETRE
        y = float(position.get("y", 0)) / _METRES_PER_KILOMETRE
        z = float(position.get("z", 0)) / _METRES_PER_KILOMETRE
        vx = float(velocity.get("x", 0)) / _METRES_PER_KILOMETRE
        vy = float(velocity.get("y", 0)) / _METRES_PER_KILOMETRE
        vz = float(velocity.get("z", 0)) / _METRES_PER_KILOMETRE
        lines.append(
            f"{point.get('time', '')} {x} {y} {z} {vx} {vy} {vz}"
        )
    return "\n".join(lines) + "\n"
