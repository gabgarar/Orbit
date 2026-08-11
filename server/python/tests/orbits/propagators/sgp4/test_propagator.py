"""SGP4 engine contract and numerical-regression tests.

The fixed Vanguard 1 vector below is a public SGP4 verification case.  It is
kept locally so the suite never depends on a live catalogue or network access.
"""

import math
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta, timezone

import pytest
from orbit_api.frames import FrameId
from orbit_api.orbits.propagators.sgp4.propagator import SGP4Propagator
from sgp4.api import Satrec, jday
from sgp4.conveniences import sat_epoch_datetime

# Vallado / SGP4 verification case 00005 (Vanguard 1).  At 2000-06-28T00:00Z
# the reference TEME state is published by the SGP4 verification suite in km
# and km/s.  The tolerance deliberately permits sub-metre differences between
# supported compiled and pure-Python SGP4 implementations, while remaining far
# tighter than any meaningful TLE uncertainty.
VANGUARD_LINE1 = "1 00005U 58002B   00179.78495062  .00000023  00000-0  28098-4 0  4753"
VANGUARD_LINE2 = "2 00005  34.2682 348.7242 1859667 331.7664  19.3264 10.82419157413667"
VANGUARD_REFERENCE_UTC = datetime(2000, 6, 28, tzinfo=UTC)
VANGUARD_REFERENCE_POSITION_KM = (-3754.2514743216166, 7876.346817439062, 4719.220856478582)
VANGUARD_REFERENCE_VELOCITY_KM_S = (-5.58365782280485, -0.9764014685717839, -1.4386317293802753)

# This official stress TLE first reports an SGP4 error at the requested epoch.
# It lets the Orbit boundary verify that an invalid state is never silently
# turned into a finite position.
DECAYED_LINE1 = "1 44160U 19006AX  20162.79712247 +.00816806 +19088-3 +34711-2 0  9997"
DECAYED_LINE2 = "2 44160 095.2472 272.0808 0216413 032.6694 328.7739 15.58006382062511"
DECAYED_ERROR_UTC = datetime(2020, 7, 25, 19, 7, 51, tzinfo=UTC)


@dataclass(frozen=True)
class _OfficialSgp4Vector:
    """One locally embedded Vallado SGP4 verification vector.

    Positions are kilometres and velocities kilometres per second, exactly as
    published in ``tcppver.out`` distributed with the ``sgp4`` dependency.
    The file is the public Vallado SGP4 verification suite, copied into the
    installed dependency, so this regression test has no network dependency.
    """

    name: str
    line1: str
    line2: str
    minutes_since_epoch: float
    position_km: tuple[float, float, float]
    velocity_km_s: tuple[float, float, float]


# Representative cases from the local/public Vallado tcppver verification
# output: near-Earth LEO, 12-hour Molniya, extreme eccentricity, GEO and a
# long deep-space propagation interval.  Keeping the numerical references in
# Orbit's test suite makes a dependency upgrade scientifically reviewable.
OFFICIAL_SGP4_VECTORS = (
    _OfficialSgp4Vector(
        "delta-1-leo",
        "1 06251U 62025E   06176.82412014  .00008885  00000-0  12808-3 0  3985",
        "2 06251  58.0579  54.0425 0030035 139.1568 221.1854 15.56387291  6774",
        120.0,
        (-3935.69800083, 409.10980837, 5471.33577327),
        (-3.374784183, -6.635211043, -1.942056221),
    ),
    _OfficialSgp4Vector(
        "molniya-12-hour-deep-space",
        "1 08195U 75081A   06176.33215444  .00000099  00000-0  11873-3 0   813",
        "2 08195  64.1586 279.0717 6877146 264.7651  20.2257  2.00491383225656",
        120.0,
        (15223.91713658, -17852.95881713, 25280.39558224),
        (1.079041732, 0.875187372, 2.485682813),
    ),
    _OfficialSgp4Vector(
        "wind-extreme-eccentricity",
        "1 23333U 94071A   94305.49999999 -.00172956  26967-3  10000-3 0    15",
        "2 23333  28.7490   2.3720 9728298  30.4360   1.3500  0.07309491    70",
        120.0,
        (-44672.91239680, -6213.11996581, -1738.80131727),
        (-3.719475070, -1.336673022, -0.621888261),
    ),
    _OfficialSgp4Vector(
        "italsat-geo",
        "1 24208U 96044A   06177.04061740 -.00000094  00000-0  10000-3 0  1600",
        "2 24208   3.8536  80.0121 0026640 311.0977  48.3000  1.00778054 36119",
        120.0,
        (-14289.19940414, 39469.05530051, 1428.62838591),
        (-2.893205245, -1.045447840, 0.179634249),
    ),
    _OfficialSgp4Vector(
        "intelsat-long-deep-space",
        "1 26900U 01039A   06106.74503247  .00000045  00000-0  10000-3 0  8290",
        "2 26900   0.0164 266.5378 0003319  86.1794 182.2590  1.00273847 16981",
        9300.0,
        (40968.68133298, -9905.99156086, 11.84946837),
        (0.722756848, 2.989645389, -0.000161261),
    ),
)


def _verification_instant(vector: _OfficialSgp4Vector) -> datetime:
    """Return the UTC instant corresponding to an official TLE offset."""

    satellite = Satrec.twoline2rv(vector.line1, vector.line2)
    return sat_epoch_datetime(satellite) + timedelta(minutes=vector.minutes_since_epoch)


def _direct_satrec_state(
    vector: _OfficialSgp4Vector,
    instant: datetime,
) -> tuple[int, tuple[float, float, float], tuple[float, float, float]]:
    """Evaluate the installed official implementation at one UTC instant."""

    julian_day, julian_fraction = jday(
        instant.year,
        instant.month,
        instant.day,
        instant.hour,
        instant.minute,
        instant.second + (instant.microsecond / 1_000_000.0),
    )
    error_code, position_km, velocity_km_s = Satrec.twoline2rv(vector.line1, vector.line2).sgp4(
        julian_day,
        julian_fraction,
    )
    return error_code, tuple(position_km), tuple(velocity_km_s)


@pytest.fixture
def vanguard_propagator() -> SGP4Propagator:
    return SGP4Propagator(VANGUARD_LINE1, VANGUARD_LINE2)


def test_sgp4_matches_the_local_vallado_reference_and_converts_native_units(
    vanguard_propagator: SGP4Propagator,
):
    """The native TEME path must retain the verified vector and SI contract."""

    raw = vanguard_propagator.propagate_teme_datetime(VANGUARD_REFERENCE_UTC)
    native = vanguard_propagator.native_state_at(VANGUARD_REFERENCE_UTC)

    assert raw[:3] == pytest.approx(VANGUARD_REFERENCE_POSITION_KM, abs=1.0e-3)
    assert raw[3:] == pytest.approx(VANGUARD_REFERENCE_VELOCITY_KM_S, abs=1.0e-6)
    assert native.epoch == VANGUARD_REFERENCE_UTC
    assert native.time_scale.value == "UTC"
    assert native.frame is FrameId.TEME
    assert native.frame_realization is None
    assert native.center == "EARTH"
    assert native.provenance == {
        "source": "TLE",
        "propagator": "sgp4",
        "native_frame": "TEME",
    }
    # Raw SGP4 is km/km/s; Orbit's typed native state is always SI.
    assert native.position_m == pytest.approx(tuple(value * 1_000.0 for value in raw[:3]), abs=1.0e-6)
    assert native.velocity_m_s == pytest.approx(tuple(value * 1_000.0 for value in raw[3:]), abs=1.0e-9)


@pytest.mark.parametrize("vector", OFFICIAL_SGP4_VECTORS, ids=lambda vector: vector.name)
def test_sgp4_matches_representative_official_vallado_verification_vectors(
    vector: _OfficialSgp4Vector,
):
    """Keep near-Earth and deep-space regression results tied to Vallado."""

    actual = SGP4Propagator(vector.line1, vector.line2).propagate_teme_datetime(
        _verification_instant(vector),
    )

    # tcppver.out prints position to 1e-8 km.  A centimetre position tolerance
    # permits the documented microsecond timestamp rounding in its text output,
    # while rejecting any scientifically meaningful implementation drift.
    assert actual[:3] == pytest.approx(vector.position_km, abs=1.0e-5)
    assert actual[3:] == pytest.approx(vector.velocity_km_s, abs=1.0e-8)


@pytest.mark.parametrize("vector", OFFICIAL_SGP4_VECTORS, ids=lambda vector: vector.name)
def test_sgp4_wrapper_matches_installed_reference_and_preserves_si_units(
    vector: _OfficialSgp4Vector,
):
    """Differentially check Orbit's UTC adapter against the installed SGP4 API."""

    instant = _verification_instant(vector)
    reference_error, reference_position_km, reference_velocity_km_s = _direct_satrec_state(
        vector,
        instant,
    )
    propagator = SGP4Propagator(vector.line1, vector.line2)
    raw = propagator.propagate_teme_datetime(instant)
    native = propagator.native_state_at(instant)

    assert reference_error == 0
    assert raw[:3] == pytest.approx(reference_position_km, abs=1.0e-10)
    assert raw[3:] == pytest.approx(reference_velocity_km_s, abs=1.0e-12)
    assert native.position_m == pytest.approx(
        tuple(component * 1_000.0 for component in reference_position_km),
        abs=1.0e-6,
    )
    assert native.velocity_m_s == pytest.approx(
        tuple(component * 1_000.0 for component in reference_velocity_km_s),
        abs=1.0e-9,
    )


@pytest.mark.parametrize(
    ("line1", "line2", "instant", "expected_error"),
    (
        pytest.param("not a TLE", "not a TLE", VANGUARD_REFERENCE_UTC, 2, id="invalid-elements"),
        pytest.param(DECAYED_LINE1, DECAYED_LINE2, DECAYED_ERROR_UTC, 1, id="invalid-propagated-state"),
    ),
)
def test_sgp4_reports_library_error_codes_and_rejects_invalid_native_states(
    line1: str,
    line2: str,
    instant: datetime,
    expected_error: int,
):
    """A library error must remain an explicit failure at Orbit's boundary."""

    julian_day, julian_fraction = jday(
        instant.year,
        instant.month,
        instant.day,
        instant.hour,
        instant.minute,
        instant.second + (instant.microsecond / 1_000_000.0),
    )
    reference_error, reference_position_km, reference_velocity_km_s = Satrec.twoline2rv(line1, line2).sgp4(
        julian_day,
        julian_fraction,
    )

    assert reference_error == expected_error
    assert all(math.isnan(component) for component in (*reference_position_km, *reference_velocity_km_s))
    with pytest.raises(ValueError, match=rf"code {expected_error}"):
        SGP4Propagator(line1, line2).native_state_at(instant)


def test_sgp4_normalizes_offset_datetimes_and_is_deterministic(
    vanguard_propagator: SGP4Propagator,
):
    """The same physical UTC instant must not drift with client time zones."""

    utc_state = vanguard_propagator.propagate_teme_datetime(VANGUARD_REFERENCE_UTC)
    repeated_state = vanguard_propagator.propagate_teme_datetime(VANGUARD_REFERENCE_UTC)
    madrid_equivalent = VANGUARD_REFERENCE_UTC.astimezone(timezone(timedelta(hours=2)))
    local_state = vanguard_propagator.propagate_teme_datetime(madrid_equivalent)
    native = vanguard_propagator.native_state_at(madrid_equivalent)

    assert repeated_state == utc_state
    assert local_state == utc_state
    assert native.epoch == VANGUARD_REFERENCE_UTC


def test_sgp4_teme_to_itrf_keeps_position_norm_and_position_only_contract(
    vanguard_propagator: SGP4Propagator,
):
    """A pure Earth-rotation transform must not scale a propagated orbit."""

    native = vanguard_propagator.native_state_at(VANGUARD_REFERENCE_UTC)
    rendered = vanguard_propagator.state_at(VANGUARD_REFERENCE_UTC, target_frame=FrameId.ITRF)
    position_only = vanguard_propagator.position_at(VANGUARD_REFERENCE_UTC, target_frame=FrameId.ITRF)

    assert rendered.frame is FrameId.ITRF
    assert rendered.transform_path == ("TEME", "PEF", "ITRF")
    assert position_only.frame is FrameId.ITRF
    assert position_only.velocity_m_s is None
    assert math.isclose(
        math.hypot(*native.position_m),
        math.hypot(*rendered.position_m),
        rel_tol=1.0e-12,
        abs_tol=1.0e-6,
    )
    # Position-only propagation uses the same rotation but intentionally skips
    # velocity derivatives for access-window calculations.
    assert position_only.position_m == pytest.approx(rendered.position_m, abs=1.0e-6)


def test_sgp4_fails_closed_for_malformed_or_decayed_tle_states():
    """Bad inputs/errors may not escape as invented Cartesian vectors."""

    malformed = SGP4Propagator("not a TLE", "not a TLE")
    decayed = SGP4Propagator(DECAYED_LINE1, DECAYED_LINE2)

    with pytest.raises(ValueError, match="code 2"):
        malformed.native_state_at(VANGUARD_REFERENCE_UTC)
    with pytest.raises(ValueError, match="code 1"):
        decayed.native_state_at(DECAYED_ERROR_UTC)


def test_sgp4_propagates_a_valid_tle_to_six_numeric_components():
    propagator = SGP4Propagator(
        "1 25544U 98067A   24001.00000000  .00000000  00000+0  00000+0 0  9991",
        "2 25544  51.6400  10.0000 0005000  30.0000 330.0000 15.50000000000000",
    )
    state = propagator.propagate()
    assert len(state) == 6
    assert all(isinstance(value, float) for value in state)


def test_sgp4_exposes_its_native_teme_state_separately_from_renderer_itrf():
    propagator = SGP4Propagator(
        "1 25544U 98067A   24001.00000000  .00000000  00000+0  00000+0 0  9991",
        "2 25544  51.6400  10.0000 0005000  30.0000 330.0000 15.50000000000000",
    )
    moment = datetime(2024, 1, 1, tzinfo=UTC)

    teme = propagator.propagate_teme_datetime(moment)
    itrf = propagator.propagate_datetime(moment)

    assert propagator.dynamics_reference_frame == "TEME"
    assert len(teme) == 6 and all(math.isfinite(value) for value in teme)
    assert len(itrf) == 6 and all(math.isfinite(value) for value in itrf)
    # The ITRF renderer contract is metres after an Earth-rotation transform,
    # while this method preserves raw SGP4 kilometres in TEME.
    assert not math.isclose(teme[0], itrf[0] / 1000.0, abs_tol=1e-6)


def test_teme_to_itrf_velocity_includes_the_correct_earth_rotation_derivative():
    x, y, _z, vx, vy, _vz = SGP4Propagator._teme_to_itrf(3_000.0, 4_000.0, 0.0, 0.0, 0.0, 0.0, 0.0)
    earth_rotation_rate = 7.2921150e-5

    assert math.isclose(vx, earth_rotation_rate * y, abs_tol=1e-12)
    assert math.isclose(vy, -earth_rotation_rate * x, abs_tol=1e-12)
