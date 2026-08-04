"""Tests for explicitly published terrestrial-realization operations."""

from __future__ import annotations

from datetime import UTC, datetime

import pytest

from orbit_api.frames import (
    FrameId,
    FrameTransformService,
    IGS20_ITRF2020_OPERATION,
    IGS20_ITRF2020_SOURCE,
    IGS20_ITRF2020_SOURCE_URL,
    StateVector,
    register_igs20_itrf2020_identity,
)
from orbit_api.timekeeping import TimeScale


def _igs20_state() -> StateVector:
    return StateVector(
        epoch=datetime(2026, 8, 3, tzinfo=UTC),
        time_scale=TimeScale.GPS,
        frame="IGS",
        frame_realization="IGS20",
        center="EARTH",
        position_m=(7_000_000.0, -1_200_000.0, 2_500_000.0),
        velocity_m_s=(1_000.0, 7_300.0, -800.0),
        provenance={"source_format": "SP3"},
    )


def test_igs20_itrf2020_identity_is_opt_in_and_records_authority():
    service = FrameTransformService(strict_eop=True)
    register_igs20_itrf2020_identity(service)

    native = _igs20_state()
    transformed = service.transform(
        native,
        target_frame=FrameId.ITRF,
        target_realization="ITRF2020",
    )

    assert transformed.frame is FrameId.ITRF
    assert transformed.frame_realization == "ITRF2020"
    assert transformed.position_m == native.position_m
    assert transformed.velocity_m_s == native.velocity_m_s
    assert transformed.transform_path == ("IGS20", "ITRF2020")
    operation = transformed.provenance["terrestrial_realization_transform"]
    assert operation["operation"] == IGS20_ITRF2020_OPERATION
    assert operation["authority"] == IGS20_ITRF2020_SOURCE
    assert operation["source_url"] == IGS20_ITRF2020_SOURCE_URL
    assert operation["parameters"]["translation_mm"] == (0.0, 0.0, 0.0)
    assert operation["station_coordinate_corrections_applied"] is False


def test_igs20_itrf2020_identity_registers_the_reverse_direction_too():
    service = FrameTransformService(strict_eop=True)
    register_igs20_itrf2020_identity(service)
    itrf_state = service.transform(
        _igs20_state(),
        target_frame=FrameId.ITRF,
        target_realization="ITRF2020",
    )

    restored = service.transform(
        itrf_state,
        target_frame="IGS",
        target_realization="IGS20",
    )

    assert restored.frame == "IGS"
    assert restored.frame_realization == "IGS20"
    assert restored.position_m == itrf_state.position_m
    assert restored.velocity_m_s == itrf_state.velocity_m_s
    assert restored.provenance["terrestrial_realization_transform"]["direction"] == "ITRF2020_to_IGS20"


def test_reverse_igs_transform_accepts_the_compact_realization_label_as_target():
    service = FrameTransformService(strict_eop=True)
    register_igs20_itrf2020_identity(service)
    itrf_state = service.transform(
        _igs20_state(),
        target_frame=FrameId.ITRF,
        target_realization="ITRF2020",
    )

    restored = service.transform(itrf_state, target_frame="IGS20")

    assert restored.frame == "IGS"
    assert restored.frame_realization == "IGS20"
    assert restored.position_m == itrf_state.position_m


def test_duplicate_realization_registration_requires_an_explicit_replacement():
    service = FrameTransformService()

    def first(state: StateVector) -> StateVector:
        return state

    def second(state: StateVector) -> StateVector:
        return state

    service.register_terrestrial_realization_transform("ITRF2020", "ITRF2014", first)

    with pytest.raises(ValueError, match="Ya existe"):
        service.register_terrestrial_realization_transform("ITRF2020", "ITRF2014", second)

    service.register_terrestrial_realization_transform(
        "ITRF2020",
        "ITRF2014",
        second,
        replace_existing=True,
    )


def test_published_helper_refuses_to_replace_a_custom_direction_or_register_half_of_it():
    service = FrameTransformService()

    def custom(state: StateVector) -> StateVector:
        return state

    service.register_terrestrial_realization_transform("IGS20", "ITRF2020", custom)

    with pytest.raises(ValueError, match="cannot replace"):
        register_igs20_itrf2020_identity(service)

    assert service.has_terrestrial_realization_transform("IGS20", "ITRF2020")
    assert not service.has_terrestrial_realization_transform("ITRF2020", "IGS20")
