"""Public contracts for frame-aware Cartesian state transformations.

These tests intentionally exercise the domain API rather than a particular
propagator.  A TLE/SGP4 source, a numerical propagator, a future SP3 reader,
and an OEM reader must all be able to hand their *native* state to this same
boundary without silently relabelling a frame.
"""

from __future__ import annotations

from dataclasses import FrozenInstanceError, replace
from datetime import UTC, datetime
import hashlib
import math

import pytest

from orbit_api.frames import (
    EarthOrientation,
    FrameId,
    FrameTransformService,
    FrameTransformationError,
    StateVector,
    TimeScale,
)
from orbit_api.timekeeping import (
    LeapSecondTable,
    LeapSecondTableExpiredError,
    configure_default_leap_second_table,
    default_leap_second_table,
    julian_date,
    utc_to_tt,
)


_EPOCH = datetime(2024, 1, 1, 12, tzinfo=UTC)
_ARCSECOND_TO_RADIAN = math.pi / (180.0 * 3_600.0)


@pytest.fixture
def eop() -> EarthOrientation:
    """A deterministic EOP record; values are deliberately non-zero.

    The fixture is not an accuracy reference to a published IERS record.  It
    makes the test prove that DUT1 and polar motion are actually consumed, and
    that their provenance is retained on the transformed result.
    """

    return EarthOrientation(
        dut1_seconds=0.3345,
        xp_radians=0.21 * _ARCSECOND_TO_RADIAN,
        yp_radians=-0.17 * _ARCSECOND_TO_RADIAN,
        source="test-eop",
        version="fixture-1",
    )


def _state(
    *,
    frame: FrameId = FrameId.TEME,
    frame_realization: str | None = None,
    epoch: datetime = _EPOCH,
    position_m: tuple[float, float, float] = (7_000_000.0, 0.0, 0.0),
    velocity_m_s: tuple[float, float, float] = (0.0, 7_500.0, 0.0),
) -> StateVector:
    return StateVector(
        epoch=epoch,
        time_scale=TimeScale.UTC,
        frame=frame,
        frame_realization=frame_realization,
        center="EARTH",
        position_m=position_m,
        velocity_m_s=velocity_m_s,
    )


def test_state_vector_requires_explicit_frame_time_scale_and_finite_si_components():
    state = _state(frame=FrameId.GCRF)

    assert state.epoch == _EPOCH
    assert state.time_scale is TimeScale.UTC
    assert state.frame is FrameId.GCRF
    assert state.center == "EARTH"
    assert state.position_m == (7_000_000.0, 0.0, 0.0)
    assert state.velocity_m_s == (0.0, 7_500.0, 0.0)

    # "ECI" is ambiguous (GCRF, J2000, TEME, ...), so it must never enter the
    # common state contract as a valid source frame.
    with pytest.raises(ValueError, match="ECI"):
        _state(frame="ECI")  # type: ignore[arg-type]

    with pytest.raises(ValueError, match="aware|UTC|zona horaria"):
        _state(epoch=datetime(2024, 1, 1, 12))

    with pytest.raises(ValueError, match="finito|finite"):
        _state(position_m=(math.nan, 0.0, 0.0))


@pytest.mark.parametrize("label", ["IGS20", "IGb20", "IGc20"])
def test_direct_igs_realization_labels_use_the_same_family_contract_as_importers(label):
    state = StateVector(
        epoch=_EPOCH,
        time_scale=TimeScale.GPS,
        frame=label,
        frame_realization=None,
        center="EARTH",
        position_m=(7_000_000.0, 0.0, 0.0),
        velocity_m_s=(0.0, 7_500.0, 0.0),
    )

    assert state.frame == "IGS"
    assert state.frame_realization == label.upper()
    assert state.frame_label == label.upper()


def test_state_vector_is_immutable_so_native_metadata_cannot_be_relabelled():
    state = _state(frame=FrameId.TEME)

    with pytest.raises(FrozenInstanceError):
        state.frame = FrameId.GCRF  # type: ignore[misc]


def test_identity_transform_is_lossless_and_does_not_require_eop():
    native = _state(frame=FrameId.TEME)

    transformed = FrameTransformService().transform(native, target_frame=FrameId.TEME)

    assert transformed == native


def test_teme_to_itrf_uses_dut1_and_retains_eop_provenance(eop: EarthOrientation):
    native = _state(frame=FrameId.TEME)
    service = FrameTransformService()

    corrected = service.transform(
        native,
        target_frame=FrameId.ITRF,
        target_realization="ITRF2020",
        earth_orientation=eop,
    )
    utc_rotation_only = service.transform(
        native,
        target_frame=FrameId.ITRF,
        target_realization="ITRF2020",
        earth_orientation=EarthOrientation(
            dut1_seconds=0.0,
            xp_radians=0.0,
            yp_radians=0.0,
            source="test-eop",
            version="fixture-zero",
        ),
    )

    assert corrected.frame is FrameId.ITRF
    assert corrected.frame_realization == "ITRF2020"
    assert corrected.epoch == native.epoch
    assert corrected.time_scale is native.time_scale
    assert corrected.position_m != pytest.approx(utc_rotation_only.position_m)
    assert corrected.velocity_m_s != pytest.approx(utc_rotation_only.velocity_m_s)
    assert corrected.earth_orientation_source == "test-eop"
    assert corrected.earth_orientation_version == "fixture-1"
    provenance = corrected.provenance["frame_transform"]
    assert provenance["earth_orientation"] == {
        "source": "test-eop",
        "version": "fixture-1",
        "quality": "approximate",
    }
    assert provenance["leap_seconds"]["version"] == default_leap_second_table().version


def test_frame_tt_julian_date_uses_the_active_pinned_leap_second_table():
    import orbit_api.frames.transforms as transforms

    table = LeapSecondTable(
        entries=(
            (datetime(2017, 1, 1, tzinfo=UTC), 37),
            (datetime(2027, 1, 1, tzinfo=UTC), 38),
        ),
        source="test local leap seconds",
        version="fixture-r2",
    )
    previous = default_leap_second_table()
    instant = datetime(2027, 1, 2, 12, tzinfo=UTC)
    try:
        configure_default_leap_second_table(table)
        tt1, tt2, _ut11, _ut12, _utc1, _utc2 = transforms._julian_parts(
            instant,
            EarthOrientation(source="test", version="r1", quality="final"),
        )
    finally:
        configure_default_leap_second_table(previous)

    assert tt1 + tt2 == pytest.approx(julian_date(utc_to_tt(instant, leap_seconds=table)))


def test_explicit_leap_second_tables_are_scoped_per_frame_transformer(eop: EarthOrientation):
    """Independent transformers must not inherit each other's UTC/TAI contract."""

    first_table = LeapSecondTable(
        entries=(
            (datetime(2017, 1, 1, tzinfo=UTC), 37),
            (datetime(2027, 1, 1, tzinfo=UTC), 38),
        ),
        source="first local leap table",
        version="first-r2",
    )
    second_table = LeapSecondTable(
        entries=((datetime(2017, 1, 1, tzinfo=UTC), 37),),
        source="second local leap table",
        version="second-r1",
    )
    unrelated_default = LeapSecondTable(
        entries=(
            (datetime(2017, 1, 1, tzinfo=UTC), 37),
            (datetime(2027, 1, 1, tzinfo=UTC), 38),
            (datetime(2028, 1, 1, tzinfo=UTC), 39),
        ),
        source="unrelated process default",
        version="global-r3",
    )
    first = FrameTransformService(leap_second_table=first_table)
    second = FrameTransformService(leap_second_table=second_table)
    legacy = FrameTransformService()
    native = StateVector(
        # The same TAI calendar label maps to a different UTC instant for
        # each table after the first service's synthetic 2027 leap second.
        epoch=datetime(2027, 1, 2, 0, 0, 38, tzinfo=UTC),
        time_scale=TimeScale.TAI,
        frame=FrameId.TEME,
        frame_realization=None,
        center="EARTH",
        position_m=(7_000_000.0, 0.0, 0.0),
        velocity_m_s=(0.0, 7_500.0, 0.0),
    )
    instant = datetime(2027, 1, 2, 12, tzinfo=UTC)
    previous = default_leap_second_table()
    try:
        # An unrelated legacy default must not alter either explicitly-pinned
        # service. This also guards cache/provenance against global leakage.
        configure_default_leap_second_table(unrelated_default)
        assert legacy.leap_second_table is unrelated_default
        first_result = first.transform(native, target_frame=FrameId.ITRF, earth_orientation=eop)
        second_result = second.transform(native, target_frame=FrameId.ITRF, earth_orientation=eop)
        first_token = first.cache_token_at(instant)
        second_token = second.cache_token_at(instant)
    finally:
        configure_default_leap_second_table(previous)

    assert first.leap_second_table is first_table
    assert second.leap_second_table is second_table
    assert first_result.position_m != pytest.approx(second_result.position_m)
    assert first_result.provenance["frame_transform"]["leap_seconds"]["version"] == "first-r2"
    assert second_result.provenance["frame_transform"]["leap_seconds"]["version"] == "second-r1"
    assert first_token != second_token
    assert "first-r2" in first_token
    assert "second-r1" in second_token

    # The TT date used by ERFA/SOFA has the same instance-scoped UTC--TAI
    # choice, rather than falling back to the process-global table.
    import orbit_api.frames.transforms as transforms

    first_tt1, first_tt2, *_ = transforms._julian_parts(
        instant,
        eop,
        leap_second_table=first.leap_second_table,
    )
    second_tt1, second_tt2, *_ = transforms._julian_parts(
        instant,
        eop,
        leap_second_table=second.leap_second_table,
    )
    assert (first_tt1 + first_tt2) - (second_tt1 + second_tt2) == pytest.approx(1.0 / 86_400.0, abs=1e-9)


def test_strict_transform_validates_its_own_pinned_leap_second_snapshot():
    expired_table = LeapSecondTable(
        entries=((datetime(2017, 1, 1, tzinfo=UTC), 37),),
        source="expired local leap table",
        version="expired-r1",
        expires_at=datetime(2027, 1, 1, tzinfo=UTC),
        sha256="a" * 64,
    )
    current_default = LeapSecondTable(
        entries=((datetime(2017, 1, 1, tzinfo=UTC), 37),),
        source="current process default",
        version="current-r1",
        expires_at=datetime(2030, 1, 1, tzinfo=UTC),
        sha256="b" * 64,
    )
    previous = default_leap_second_table()
    try:
        configure_default_leap_second_table(current_default)
        with pytest.raises(LeapSecondTableExpiredError, match="caduc"):
            FrameTransformService(strict_eop=True, leap_second_table=expired_table).transform(
                _state(epoch=datetime(2027, 1, 2, tzinfo=UTC)),
                target_frame=FrameId.ITRF,
                earth_orientation=EarthOrientation(source="IERS fixture", version="r1", quality="final"),
            )
    finally:
        configure_default_leap_second_table(previous)


def test_polar_motion_is_applied_after_earth_rotation_and_preserves_radius(eop: EarthOrientation):
    # A z-axis state is unchanged by the TEME -> PEF Earth-rotation step.
    # Any horizontal component in ITRF therefore demonstrates the xp/yp step
    # rather than just GMST.  Rotation must preserve the Euclidean radius.
    native = _state(
        frame=FrameId.TEME,
        position_m=(0.0, 0.0, 7_000_000.0),
        velocity_m_s=(0.0, 0.0, 0.0),
    )

    transformed = FrameTransformService().transform(
        native,
        target_frame=FrameId.ITRF,
        target_realization="ITRF2020",
        earth_orientation=eop,
    )

    assert abs(transformed.position_m[0]) + abs(transformed.position_m[1]) > 0.01
    assert math.sqrt(sum(component * component for component in transformed.position_m)) == pytest.approx(
        7_000_000.0,
        abs=1e-6,
    )


def test_strict_frame_workflows_reject_the_named_visual_eop_fallback():
    native = _state(frame=FrameId.TEME)

    with pytest.raises(FrameTransformationError, match="EOP|aproximaci"):
        FrameTransformService(strict_eop=True).transform(native, target_frame=FrameId.ITRF)


def test_strict_frame_workflows_accept_only_final_or_rapid_eop_quality():
    with pytest.raises(FrameTransformationError, match="final|rapid"):
        FrameTransformService(strict_eop=True).transform(
            _state(frame=FrameId.TEME),
            target_frame=FrameId.ITRF,
            earth_orientation=EarthOrientation(source="IERS test", version="predicted-r1", quality="predicted"),
        )


def test_strict_frame_workflows_do_not_downgrade_when_pyerfa_is_unavailable(monkeypatch):
    # A final EOP product alone does not make the fallback GMST model a
    # strict GCRF/ITRF transformation.  The production dependency is pyerfa;
    # this test makes the failure deterministic even in environments where it
    # happens to be installed.
    import orbit_api.frames.transforms as transforms

    monkeypatch.setattr(transforms, "_erfa", None)
    final_eop = EarthOrientation(source="IERS fixture", version="final-r1", quality="final")

    with pytest.raises(FrameTransformationError, match="pyerfa|SOFA"):
        FrameTransformService(strict_eop=True).transform(
            _state(frame=FrameId.EME2000),
            target_frame=FrameId.ITRF,
            earth_orientation=final_eop,
        )


def test_strict_transform_rejects_an_epoch_after_a_pinned_leap_table_expires(tmp_path):
    contents = b"#@ 4007750400\n3692217600 37 # 1 Jan 2017\n"
    snapshot = tmp_path / "leap-seconds.list"
    snapshot.write_bytes(contents)
    table = LeapSecondTable.from_file(
        snapshot,
        expected_sha256=hashlib.sha256(contents).hexdigest(),
    )
    previous = default_leap_second_table()
    try:
        configure_default_leap_second_table(table)
        with pytest.raises(LeapSecondTableExpiredError, match="caduc"):
            FrameTransformService(strict_eop=True).transform(
                _state(epoch=datetime(2027, 1, 1, tzinfo=UTC)),
                target_frame=FrameId.ITRF,
                earth_orientation=EarthOrientation(source="IERS fixture", version="r1", quality="final"),
            )
    finally:
        configure_default_leap_second_table(previous)


def test_registered_itrf_realization_change_does_not_need_earth_orientation_data():
    native = _state(frame=FrameId.ITRF, frame_realization="ITRF2020")
    service = FrameTransformService(strict_eop=True)

    def itrf2020_to_itrf2014(state: StateVector) -> StateVector:
        return replace(state, frame=FrameId.ITRF, frame_realization="ITRF2014")

    service.register_terrestrial_realization_transform(
        "ITRF2020",
        "ITRF2014",
        itrf2020_to_itrf2014,
    )

    transformed = service.transform(
        native,
        target_frame=FrameId.ITRF,
        target_realization="ITRF2014",
    )

    assert transformed.frame is FrameId.ITRF
    assert transformed.frame_realization == "ITRF2014"


def test_generic_itrf_is_not_silently_relabelled_as_a_specific_realization():
    native = _state(frame=FrameId.ITRF, frame_realization=None)
    service = FrameTransformService(default_terrestrial_realization="ITRF2020")

    with pytest.raises(FrameTransformationError, match="sin realizaci.n"):
        service.transform(native, target_frame=FrameId.ITRF)


def test_external_igs_realization_is_not_silently_relabelled_as_itrf():
    native = StateVector(
        epoch=_EPOCH,
        time_scale=TimeScale.GPS,
        frame="IGS",
        frame_realization="IGS20",
        center="EARTH",
        position_m=(7_000_000.0, 0.0, 0.0),
        velocity_m_s=(0.0, 7_500.0, 0.0),
    )

    with pytest.raises(FrameTransformationError, match="realizaci"):
        FrameTransformService().transform(native, target_frame=FrameId.ITRF)

    with pytest.raises(FrameTransformationError, match="external terrestrial frame"):
        FrameTransformService().transform(native, target_frame=FrameId.GCRF)
