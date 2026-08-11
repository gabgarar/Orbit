"""Contracts for SP3 header metadata parsing."""

from datetime import datetime

import pytest

from orbit_api.formats import EphemerisFormatError, TimeScale, parse_reference_frame, parse_sp3_metadata


def _sp3_header(*, frame: str = "IGS20") -> str:
    return (
        "#cP"
        "2026 07 26 13 05 35.25000000"
        f" {96:7d} "
        f"{'ORBIT':<5} "
        f"{frame:<5} "
        f"{'FIT':<3} "
        f"{'COD':<4}"
    )


def test_sp3_metadata_preserves_its_native_igs_frame_and_gps_time_scale():
    source = "\n".join(
        [
            _sp3_header(),
            "## 2429 0.00000000 900.00000000 61000 0.0000000000000",
            "+    1   G01",
            "%c cc GPS ccc ccc ccc ccc ccc ccc ccc ccc ccc ccc ccc ccc",
        ]
    )

    metadata = parse_sp3_metadata(source)

    assert metadata.format_name == "SP3"
    assert metadata.version == "c"
    assert metadata.record_type == "P"
    assert metadata.epoch == datetime(2026, 7, 26, 13, 5, 35, 250_000)
    assert metadata.number_of_epochs == 96
    assert metadata.data_used == "ORBIT"
    assert metadata.reference_frame.family == "IGS"
    assert metadata.reference_frame.realization == "IGS20"
    assert metadata.reference_frame.label == "IGS20"
    assert metadata.time_scale is TimeScale.GPS
    assert metadata.time_scale_label == "GPS"
    assert metadata.orbit_type == "FIT"
    assert metadata.agency == "COD"


def test_sp3_standard_percent_c_header_skips_its_cc_placeholder_for_gps():
    """A real CODE/IGS SP3 uses ``M cc GPS``, not ``cc`` as TIME_SYSTEM."""

    source = "\n".join(
        [
            _sp3_header(frame="IGb20"),
            "## 2366      0.00000000   300.00000000 60806 0.0000000000000",
            "+    1   G01",
            "%c M  cc GPS ccc cccc cccc cccc ccccc ccccc ccccc ccccc",
        ]
    )

    metadata = parse_sp3_metadata(source)

    assert metadata.reference_frame.label == "IGB20"
    assert metadata.time_scale is TimeScale.GPS
    assert metadata.time_scale_label == "GPS"


def test_sp3_trimmed_standard_percent_c_header_keeps_the_third_time_token():
    source = "\n".join([_sp3_header(), "%c M cc GPS ccc cccc"])

    metadata = parse_sp3_metadata(source)

    assert metadata.time_scale is TimeScale.GPS
    assert metadata.time_scale_label == "GPS"


def test_sp3_keeps_unknown_time_scale_label_without_assuming_utc():
    source = "\n".join([_sp3_header(frame="ITRF"), "%c cc FUTURE ccc ccc"])

    metadata = parse_sp3_metadata(source)

    assert metadata.reference_frame.family == "ITRF"
    assert metadata.reference_frame.realization is None
    assert metadata.time_scale is TimeScale.UNKNOWN
    assert metadata.time_scale_label == "FUTURE"


def test_sp3_requires_both_coordinate_and_time_system_metadata():
    header_without_frame = _sp3_header(frame="     ")

    with pytest.raises(EphemerisFormatError, match="coordenadas"):
        parse_sp3_metadata("\n".join([header_without_frame, "%c cc UTC ccc"]))
    with pytest.raises(EphemerisFormatError, match="TIME_SYSTEM"):
        parse_sp3_metadata(_sp3_header())


@pytest.mark.parametrize("label", ["IGb08", "IGS20", "IGb20", "IGc20"])
def test_igs_realizations_are_preserved_without_becoming_itrf_labels(label: str):
    frame = parse_reference_frame(label)

    assert frame.family == "IGS"
    assert frame.realization == label.upper()
    assert frame.label == label.upper()
