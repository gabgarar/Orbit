"""Time-contract tests shared by native tabular ephemeris providers."""

from datetime import UTC, datetime, timedelta

from orbit_api.formats import (
    OemMetadata,
    OemSegmentMetadata,
    OemStateProvider,
    ReferenceFrame,
    Sp3Metadata,
    Sp3StateProvider,
    TabularStateProvider,
)
from orbit_api.frames import FrameId, FrameTransformService, StateVector
from orbit_api.timekeeping import (
    EarthOrientation,
    LeapSecondTable,
    StaticEarthOrientationProvider,
    TimeScale,
    configure_default_leap_second_table,
    default_leap_second_table,
    from_utc,
)


def _tai_sample(epoch: datetime, *, position_x_m: float) -> StateVector:
    return StateVector(
        epoch=epoch,
        time_scale=TimeScale.TAI,
        frame=FrameId.EME2000,
        frame_realization=None,
        center="EARTH",
        position_m=(position_x_m, 0.0, 0.0),
        velocity_m_s=(0.0, 0.0, 0.0),
    )


def test_tabular_queries_use_the_transformers_scoped_leap_second_table():
    first_table = LeapSecondTable(
        entries=(
            (datetime(2017, 1, 1, tzinfo=UTC), 37),
            (datetime(2027, 1, 1, tzinfo=UTC), 38),
        ),
        source="first tabular leap table",
        version="first-r2",
    )
    second_table = LeapSecondTable(
        entries=((datetime(2017, 1, 1, tzinfo=UTC), 37),),
        source="second tabular leap table",
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
    instant = datetime(2028, 1, 2, tzinfo=UTC)
    first_sample = _tai_sample(
        from_utc(instant, TimeScale.TAI, leap_seconds=first_table),
        position_x_m=7_000_000.0,
    )
    second_sample = _tai_sample(
        from_utc(instant, TimeScale.TAI, leap_seconds=second_table),
        position_x_m=8_000_000.0,
    )
    first_provider = TabularStateProvider(
        source_format="TEST",
        samples=(first_sample,),
        frame_transformer=FrameTransformService(leap_second_table=first_table),
    )
    second_provider = TabularStateProvider(
        source_format="TEST",
        samples=(second_sample,),
        frame_transformer=FrameTransformService(leap_second_table=second_table),
    )
    previous = default_leap_second_table()
    try:
        # If TabularStateProvider used the compatibility global, it would seek
        # the 00:00:39 TAI sample from this unrelated table instead of either
        # source-native epoch below.
        configure_default_leap_second_table(unrelated_default)
        assert first_provider.native_state_at(instant) is first_sample
        assert second_provider.native_state_at(instant) is second_sample
    finally:
        configure_default_leap_second_table(previous)


def test_tabular_queries_resolve_dut1_for_utc_and_ut1_source_calendars():
    utc = datetime(2026, 7, 26, 12, tzinfo=UTC)
    dut1_seconds = 0.25
    ut1 = utc + timedelta(seconds=dut1_seconds)
    transformer = FrameTransformService(
        StaticEarthOrientationProvider(
            EarthOrientation(
                dut1_seconds=dut1_seconds,
                source="IERS test",
                version="dut1-fixture",
                quality="final",
            )
        )
    )
    ut1_sample = StateVector(
        epoch=ut1,
        time_scale=TimeScale.UT1,
        frame=FrameId.EME2000,
        frame_realization=None,
        center="EARTH",
        position_m=(7_000_000.0, 0.0, 0.0),
        velocity_m_s=(0.0, 0.0, 0.0),
    )
    ut1_provider = TabularStateProvider(
        source_format="TEST",
        samples=(ut1_sample,),
        frame_transformer=transformer,
    )
    tai_sample = _tai_sample(from_utc(utc, TimeScale.TAI), position_x_m=8_000_000.0)
    tai_provider = TabularStateProvider(
        source_format="TEST",
        samples=(tai_sample,),
        frame_transformer=transformer,
    )

    # UTC -> native UT1 gets DUT1 from the configured EOP provider.
    assert ut1_provider.native_state_at(utc) is ut1_sample
    # A UT1 query follows provisional UTC -> EOP -> refined UTC before it is
    # rendered in the source-native TAI calendar.
    assert tai_provider.native_state_at(ut1, time_scale=TimeScale.UT1) is tai_sample


def test_direct_sp3_and_oem_construction_aligns_children_to_parent_transformer():
    epoch = datetime(2027, 1, 2, tzinfo=UTC)
    parent_table = LeapSecondTable(
        entries=(
            (datetime(2017, 1, 1, tzinfo=UTC), 37),
            (datetime(2027, 1, 1, tzinfo=UTC), 38),
        ),
        source="parent leap table",
        version="parent-r2",
    )
    child_table = LeapSecondTable(
        entries=((datetime(2017, 1, 1, tzinfo=UTC), 37),),
        source="child leap table",
        version="child-r1",
    )
    parent_transformer = FrameTransformService(leap_second_table=parent_table)
    child = TabularStateProvider(
        source_format="TEST",
        samples=(_tai_sample(from_utc(epoch, TimeScale.TAI, leap_seconds=parent_table), position_x_m=7_000_000.0),),
        frame_transformer=FrameTransformService(leap_second_table=child_table),
    )
    reference = ReferenceFrame(family="EME2000", realization=None, label="EME2000")
    sp3 = Sp3StateProvider(
        metadata=Sp3Metadata(
            version="c",
            record_type="P",
            epoch=epoch.replace(tzinfo=None),
            number_of_epochs=1,
            data_used=None,
            reference_frame=reference,
            time_scale=TimeScale.TAI,
            time_scale_label="TAI",
            orbit_type=None,
            agency=None,
        ),
        satellites={"G01": child},
        frame_transformer=parent_transformer,
    )
    segment = OemSegmentMetadata(
        object_name="TEST",
        object_id=None,
        center_name="EARTH",
        reference_frame=reference,
        time_scale=TimeScale.TAI,
        time_scale_label="TAI",
        start_time=None,
        stop_time=None,
        usable_start_time=None,
        usable_stop_time=None,
        interpolation=None,
        interpolation_degree=None,
        comments=(),
        extensions=(),
    )
    oem = OemStateProvider(
        metadata=OemMetadata(
            version="2.0",
            creation_date=None,
            originator=None,
            comments=(),
            segments=(segment,),
            extensions=(),
        ),
        segment_providers=(child,),
        frame_transformer=parent_transformer,
    )

    assert sp3.frame_transformer is parent_transformer
    assert sp3.for_satellite("G01").frame_transformer is parent_transformer
    assert oem.frame_transformer is parent_transformer
    assert oem.segment(0).frame_transformer is parent_transformer
