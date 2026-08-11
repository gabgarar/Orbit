"""Deterministic contracts for local, versioned Earth-orientation data."""

from datetime import UTC, datetime, timedelta
import hashlib

import pytest

from orbit_api.timekeeping import (
    ARCSECOND_TO_RADIAN,
    EarthOrientation,
    EarthOrientationCoverageError,
    EopSnapshotValidationError,
    IersC04EarthOrientationProvider,
    IgsErpEarthOrientationProvider,
    StaticEarthOrientationProvider,
    TabularEarthOrientationProvider,
)


_START = datetime(2024, 1, 1, tzinfo=UTC)


def _sample(*, epoch: datetime, dut1: float, xp_arcsec: float, yp_arcsec: float) -> EarthOrientation:
    return EarthOrientation(
        dut1_seconds=dut1,
        xp_radians=xp_arcsec * ARCSECOND_TO_RADIAN,
        yp_radians=yp_arcsec * ARCSECOND_TO_RADIAN,
        dx_radians=0.01 * ARCSECOND_TO_RADIAN,
        dy_radians=-0.02 * ARCSECOND_TO_RADIAN,
        lod_seconds=0.001,
        source="IERS test table",
        version="fixture-r1",
        quality="final",
        sampled_at=epoch,
    )


def test_static_eop_provider_preserves_revision_and_attaches_requested_utc_epoch():
    provider = StaticEarthOrientationProvider(
        EarthOrientation(
            dut1_seconds=0.123,
            xp_radians=1e-7,
            yp_radians=-2e-7,
            source="IERS C04",
            version="2024-01-01",
            quality="final",
        )
    )

    sample = provider.at(_START + timedelta(hours=2))

    assert sample.sampled_at == _START + timedelta(hours=2)
    assert sample.cache_token == ("IERS C04", "2024-01-01", "final")
    assert sample.dut1_seconds == pytest.approx(0.123)


def test_tabular_eop_provider_interpolates_all_orientation_terms_and_rejects_gaps():
    end = _START + timedelta(days=1)
    provider = TabularEarthOrientationProvider(
        (
            _sample(epoch=_START, dut1=0.1, xp_arcsec=0.2, yp_arcsec=-0.3),
            _sample(epoch=end, dut1=0.3, xp_arcsec=0.6, yp_arcsec=0.1),
        )
    )

    midpoint = provider.at(_START + timedelta(hours=12))

    assert midpoint.sampled_at == _START + timedelta(hours=12)
    assert midpoint.dut1_seconds == pytest.approx(0.2)
    assert midpoint.xp_radians == pytest.approx(0.4 * ARCSECOND_TO_RADIAN)
    assert midpoint.yp_radians == pytest.approx(-0.1 * ARCSECOND_TO_RADIAN)
    assert midpoint.dx_radians == pytest.approx(0.01 * ARCSECOND_TO_RADIAN)
    assert midpoint.dy_radians == pytest.approx(-0.02 * ARCSECOND_TO_RADIAN)
    assert midpoint.source == "IERS test table"
    assert midpoint.version == "fixture-r1"
    assert midpoint.quality == "final"
    with pytest.raises(EarthOrientationCoverageError, match="cobertura"):
        provider.at(_START - timedelta(seconds=1))
    with pytest.raises(EarthOrientationCoverageError, match="cobertura"):
        provider.at(end + timedelta(seconds=1))


def test_eop_extrapolation_is_visible_in_the_quality_metadata():
    provider = TabularEarthOrientationProvider(
        (_sample(epoch=_START, dut1=0.1, xp_arcsec=0.2, yp_arcsec=-0.3),),
        allow_extrapolation=True,
    )

    extrapolated = provider.at(_START + timedelta(days=2))

    assert extrapolated.quality == "extrapolated"
    assert extrapolated.sampled_at == _START + timedelta(days=2)
    assert extrapolated.cache_token == ("IERS test table", "fixture-r1", "extrapolated")


def test_igs_erp_v2_parser_converts_published_units_and_keeps_snapshot_identity():
    contents = """
        version 2
        MJD Xpole Ypole UT1-UTC LOD Xsig Ysig UTsig LODsig Nr Nf Nt Xrt Yrt
        61247.00000 1000000 -2000000 2500000 10000 0 0 0 0 0 0 0 0 0
        61248.00000 3000000  2000000 4500000 30000 0 0 0 0 0 0 0 0 0
    """.strip()

    provider = IgsErpEarthOrientationProvider.from_text(
        contents,
        filename="IGS0OPSFIN_20262070000_01D_ERP.ERP",
        source="IGS ERP test",
        version="fixture-erp-v2",
        quality="final",
    )

    start = datetime(2026, 7, 26, tzinfo=UTC)
    sample = provider.at(start)
    midpoint = provider.at(start + timedelta(hours=12))
    identity = provider.snapshot_identity

    assert sample.dut1_seconds == pytest.approx(0.25)
    assert sample.lod_seconds == pytest.approx(0.001)
    assert sample.xp_radians == pytest.approx(1.0 * ARCSECOND_TO_RADIAN)
    assert sample.yp_radians == pytest.approx(-2.0 * ARCSECOND_TO_RADIAN)
    assert sample.dx_radians == 0.0
    assert sample.dy_radians == 0.0
    assert sample.source == "IGS ERP test"
    assert sample.version == "fixture-erp-v2"
    assert midpoint.dut1_seconds == pytest.approx(0.35)
    assert midpoint.xp_radians == pytest.approx(2.0 * ARCSECOND_TO_RADIAN)
    assert identity is not None
    assert identity.filename == "IGS0OPSFIN_20262070000_01D_ERP.ERP"
    assert identity.coverage_start == start
    assert identity.coverage_end == start + timedelta(days=1)
    assert sample.snapshot_id == f"sha256:{hashlib.sha256(contents.encode('utf-8')).hexdigest()}"


def test_iers_c04_14_parser_converts_arcseconds_and_keeps_a_pinned_version():
    provider = IersC04EarthOrientationProvider.from_text(
        """
        # year month day MJD xp yp UT1-UTC LOD dX dY
        2024 1 1 60310.0 0.20 -0.30 0.125 0.001 0.01 -0.02
        2024 1 2 60311.0 0.40 -0.10 0.225 0.002 0.03 -0.04
        """,
        source="IERS EOP C04",
        version="pinned-fixture",
    )

    sample = provider.at(_START)

    assert sample.source == "IERS EOP C04"
    assert sample.version == "pinned-fixture"
    assert sample.quality == "final"
    assert sample.dut1_seconds == pytest.approx(0.125)
    assert sample.lod_seconds == pytest.approx(0.001)
    assert sample.xp_radians == pytest.approx(0.20 * ARCSECOND_TO_RADIAN)
    assert sample.yp_radians == pytest.approx(-0.30 * ARCSECOND_TO_RADIAN)
    assert sample.dx_radians == pytest.approx(0.01 * ARCSECOND_TO_RADIAN)
    assert sample.dy_radians == pytest.approx(-0.02 * ARCSECOND_TO_RADIAN)


def test_iers_c04_20_parser_preserves_the_utc_hour_and_uses_its_distinct_lod_column():
    provider = IersC04EarthOrientationProvider.from_text(
        """
        # year month day HH MJD xp yp UT1-UTC dX dY x-rate y-rate LOD
        2024 1 1 12 60310.50 0.20 -0.30 0.125 0.01 -0.02 0.004 -0.005 0.0015
        """,
        source="IERS EOP 20 C04",
        version="pinned-20-fixture",
    )

    sample = provider.at(datetime(2024, 1, 1, 12, tzinfo=UTC))

    assert sample.sampled_at == datetime(2024, 1, 1, 12, tzinfo=UTC)
    assert sample.source == "IERS EOP 20 C04"
    assert sample.version == "pinned-20-fixture"
    assert sample.dut1_seconds == pytest.approx(0.125)
    assert sample.lod_seconds == pytest.approx(0.0015)
    assert sample.xp_radians == pytest.approx(0.20 * ARCSECOND_TO_RADIAN)
    assert sample.yp_radians == pytest.approx(-0.30 * ARCSECOND_TO_RADIAN)
    assert sample.dx_radians == pytest.approx(0.01 * ARCSECOND_TO_RADIAN)
    assert sample.dy_radians == pytest.approx(-0.02 * ARCSECOND_TO_RADIAN)


def test_iers_c04_parser_ignores_plain_text_headers_but_not_bad_numeric_rows():
    provider = IersC04EarthOrientationProvider.from_text(
        """
        EOP (IERS) 20 C04
        year month day hour MJD x y UT1-UTC dX dY x-rate y-rate LOD
        2024 1 1 0 60310.0 0.20 -0.30 0.125 0.01 -0.02 0.004 -0.005 0.0015
        """
    )

    assert provider.at(_START).dut1_seconds == pytest.approx(0.125)


@pytest.mark.parametrize("header", [
    "# year month day MJD xp yp UT1-UTC LOD dPsi dEps",
    "EOP 14 C04 IAU1980: dPsi dEps",
])
def test_iers_c04_parser_rejects_legacy_dpsi_deps_headers(header: str):
    with pytest.raises(EopSnapshotValidationError, match="dPsi/dEps"):
        IersC04EarthOrientationProvider.from_text(
            f"{header}\n2024 1 1 60310.0 0.20 -0.30 0.125 0.001 0.01 -0.02"
        )


def test_iers_c04_parser_rejects_an_unknown_row_instead_of_shifting_columns():
    # C04-20 is a 0h/12h product. An arbitrary fourth column must not be
    # treated as either a valid hour or as a C04-14 MJD.
    unknown_layout = "2024 1 1 6 60310.25 0.20 -0.30 0.125 0.01 -0.02 0.004 -0.005 0.0015"

    with pytest.raises(ValueError, match="Formato EOP C04|C04-14|C04-20"):
        IersC04EarthOrientationProvider.from_text(unknown_layout)


def test_local_c04_snapshot_has_a_content_identity_and_verifies_the_expected_hash(tmp_path):
    contents = (
        "2024 1 1 60310.0 0.20 -0.30 0.125 0.001 0.01 -0.02\n"
        "2024 1 2 60311.0 0.40 -0.10 0.225 0.002 0.03 -0.04\n"
    ).encode("utf-8")
    snapshot = tmp_path / "eopc04_202401.txt"
    snapshot.write_bytes(contents)
    digest = hashlib.sha256(contents).hexdigest()

    provider = IersC04EarthOrientationProvider.from_file(
        snapshot,
        expected_sha256=digest,
        version="2024.01.02-final",
    )

    identity = provider.snapshot_identity
    assert identity is not None
    assert identity.filename == snapshot.name
    assert identity.sha256 == digest
    assert identity.record_count == 2
    assert identity.coverage_start == _START
    assert identity.coverage_end == _START + timedelta(days=1)
    assert provider.at(_START).snapshot_id == f"sha256:{digest}"
    assert provider.at(_START).identity_token == ("IERS EOP C04", "2024.01.02-final", "final", f"sha256:{digest}")

    with pytest.raises(EopSnapshotValidationError, match="SHA-256"):
        IersC04EarthOrientationProvider.from_file(snapshot, expected_sha256="0" * 64)


def test_iers_c04_snapshot_rejects_a_calendar_mjd_mismatch_and_unsorted_rows():
    with pytest.raises(ValueError, match="Formato EOP C04"):
        IersC04EarthOrientationProvider.from_text(
            "2024 1 1 60311.0 0.20 -0.30 0.125 0.001 0.01 -0.02"
        )
    with pytest.raises(EopSnapshotValidationError, match="cronol"):
        IersC04EarthOrientationProvider.from_text(
            "2024 1 2 60311.0 0.40 -0.10 0.225 0.002 0.03 -0.04\n"
            "2024 1 1 60310.0 0.20 -0.30 0.125 0.001 0.01 -0.02"
        )
