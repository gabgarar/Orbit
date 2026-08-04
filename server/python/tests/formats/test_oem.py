"""Contracts for CCSDS OEM metadata parsing."""

import pytest

from orbit_api.formats import EphemerisFormatError, TimeScale, parse_oem_metadata


def test_oem_metadata_keeps_each_segment_frame_and_time_system():
    source = """
CCSDS_OEM_VERS = 2.0
CREATION_DATE = 2026-07-26T13:05:35.250Z
ORIGINATOR = Orbit
COMMENT = Native frame metadata must remain segment-scoped.

META_START
OBJECT_NAME = TEST SATELLITE
OBJECT_ID = 2026-001A
CENTER_NAME = EARTH
REF_FRAME = ITRF2020
TIME_SYSTEM = UTC
START_TIME = 2026-07-26T13:05:35.250Z
STOP_TIME = 2026-07-26T14:05:35.250Z
INTERPOLATION = LAGRANGE
INTERPOLATION_DEGREE = 7
META_STOP

META_START
OBJECT_NAME = TEST SATELLITE
OBJECT_ID = 2026-001A
CENTER_NAME = EARTH
REF_FRAME = EME2000
TIME_SYSTEM = TAI
START_TIME = 2026-07-26T13:05:35.250
STOP_TIME = 2026-07-26T14:05:35.250
META_STOP
"""

    metadata = parse_oem_metadata(source)

    assert metadata.format_name == "OEM"
    assert metadata.version == "2.0"
    assert metadata.creation_date == "2026-07-26T13:05:35.250Z"
    assert metadata.comments == ("Native frame metadata must remain segment-scoped.",)
    assert len(metadata.segments) == 2

    terrestrial, inertial = metadata.segments
    assert terrestrial.reference_frame.family == "ITRF"
    assert terrestrial.reference_frame.realization == "ITRF2020"
    assert terrestrial.time_scale is TimeScale.UTC
    assert terrestrial.start_time == "2026-07-26T13:05:35.250Z"
    assert terrestrial.interpolation == "LAGRANGE"
    assert terrestrial.interpolation_degree == 7
    assert inertial.reference_frame.family == "EME2000"
    assert inertial.reference_frame.realization is None
    assert inertial.time_scale is TimeScale.TAI


def test_oem_rejects_a_segment_without_a_frame_or_time_scale():
    source = """
CCSDS_OEM_VERS = 2.0
META_START
OBJECT_NAME = TEST
TIME_SYSTEM = UTC
META_STOP
"""

    with pytest.raises(EphemerisFormatError, match="REF_FRAME"):
        parse_oem_metadata(source)


def test_oem_rejects_unclosed_metadata_blocks():
    source = """
CCSDS_OEM_VERS = 2.0
META_START
REF_FRAME = ITRF
TIME_SYSTEM = UTC
"""

    with pytest.raises(EphemerisFormatError, match="META_STOP"):
        parse_oem_metadata(source)


@pytest.mark.parametrize(
    ("interpolation", "degree", "message"),
    [
        ("LAGRANGE", None, "INTERPOLATION_DEGREE"),
        ("HERMITE", "4", "grado impar"),
        ("LINEAR", "2", "LINEAR"),
    ],
)
def test_oem_validates_interpolation_declarations(
    interpolation: str,
    degree: str | None,
    message: str,
):
    degree_line = f"INTERPOLATION_DEGREE = {degree}" if degree is not None else ""
    source = f"""
CCSDS_OEM_VERS = 2.0
META_START
OBJECT_NAME = TEST
REF_FRAME = EME2000
TIME_SYSTEM = UTC
INTERPOLATION = {interpolation}
{degree_line}
META_STOP
"""

    with pytest.raises(EphemerisFormatError, match=message):
        parse_oem_metadata(source)


def test_oem_preserves_igc20_as_an_igs_realization_without_relabelling_it_itrf():
    source = """
CCSDS_OEM_VERS = 2.0
META_START
OBJECT_NAME = TEST
CENTER_NAME = EARTH
REF_FRAME = IGc20
TIME_SYSTEM = GPS
META_STOP
"""

    metadata = parse_oem_metadata(source)
    frame = metadata.segments[0].reference_frame

    assert frame.family == "IGS"
    assert frame.realization == "IGC20"
    assert frame.label == "IGC20"
