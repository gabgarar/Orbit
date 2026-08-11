"""Safety contracts for ERP-backed precise-GNSS ECI conversion."""

from __future__ import annotations

import base64
import math
from datetime import UTC, datetime

import pytest
from orbit_api.application.precise_products import (
    PreciseProductImportError,
    import_precise_product,
)
from orbit_api.frames import FrameId, FrameTransformationError, FrameTransformService
from orbit_api.timekeeping import EarthOrientation, LeapSecondTable


def _sp3_record(satellite_id: str, x: float, y: float, z: float, clock: float) -> str:
    """Create a fixed-column P record accepted by strict SP3 import."""

    return f"P{satellite_id}{x:14.6f}{y:14.6f}{z:14.6f}{clock:14.6f}"


def _sp3_text(*, time_scale: str = "UTC", epoch_second: int = 18) -> str:
    second = f"{epoch_second:02d}.00000000"
    return "\n".join((
        f"#cP2026 07 26 00 00 {second}       2 ORBIT ITRF  FIT COD ",
        "## 0000 0 60.00000000 0 0",
        "+    1   G01",
        f"%c cc {time_scale} ccc ccc ccc ccc ccc ccc ccc ccc ccc ccc ccc ccc",
        f"*  2026 07 26 00 00 {second}",
        _sp3_record("G01", 7000.0, 100.0, -25.0, 0.123456),
        f"*  2026 07 26 00 01 {second}",
        _sp3_record("G01", 7060.0, 110.0, -20.0, 0.123457),
    ))


def _erp_text(*, end_mjd: float = 61248.0) -> str:
    return "\n".join((
        "VERSION 2",
        "MJD Xpole Ypole UT1-UTC LOD",
        "61247.00000000 100000 -200000 2500000 10000",
        f"{end_mjd:.8f} 120000 -180000 2600000 11000",
    ))


def _upload(name: str, text: str) -> tuple[str, str]:
    return name, base64.b64encode(text.encode("utf-8")).decode("ascii")


def _rigorous_transformer() -> FrameTransformService:
    """A local, hashed IERS/NTP-style table valid for the fixture interval."""

    return FrameTransformService(
        leap_second_table=LeapSecondTable(
            entries=((datetime(2025, 1, 1, tzinfo=UTC), 38),),
            source="fixture local leap-second table",
            version="fixture-2025",
            expires_at=datetime(2027, 1, 1, tzinfo=UTC),
            sha256="c" * 64,
        )
    )


def _product(
    *,
    require_eci: bool = False,
    erp_text: str | None = None,
    frame_transformer: FrameTransformService | None = None,
):
    return import_precise_product(
        (
            _upload("IGS0OPSFIN_20262070000_01D_05M_ORB.SP3", _sp3_text()),
            _upload("IGS0OPSFIN_20262070000_01D_ERP.ERP", erp_text or _erp_text()),
        ),
        require_eci=require_eci,
        frame_transformer=frame_transformer or _rigorous_transformer(),
    )


def test_precise_eci_requires_full_erp_coverage_when_requested_at_import_time():
    # The SP3 runs from 00:00:18 to 00:01:18.  This ERP ends at 00:00:43.2,
    # so an ordinary import may retain it, but an operation explicitly asking
    # for ECI must fail before a product can be persisted.
    with pytest.raises(PreciseProductImportError, match="no cubre toda la ventana SP3"):
        _product(require_eci=True, erp_text=_erp_text(end_mjd=61247.0005))


def test_precise_eci_rotation_uses_erp_and_preserves_the_cartesian_norm():
    product = _product(require_eci=True)

    capability = product.eci_conversion_summary()
    assert capability["available"] is True
    assert capability["iau2006_2000a_available"] is True
    assert capability["model"] == "IAU 2006/2000A + IERS ERP"

    native = product.provider_for_satellite("G01").native_state_at(
        datetime(2026, 7, 26, 0, 0, 18, tzinfo=UTC),
    )
    inertial = product.eci_state_at("G01", datetime(2026, 7, 26, 0, 0, 18, tzinfo=UTC))

    assert inertial.frame is FrameId.EME2000
    assert inertial.earth_orientation_snapshot_id == product.erp.snapshot_identity.content_id
    assert math.hypot(*inertial.position_m) == pytest.approx(math.hypot(*native.position_m), rel=1e-12, abs=1e-6)


def test_precise_eci_is_not_advertised_or_executed_without_iau2006(monkeypatch):
    from orbit_api.frames import transforms

    monkeypatch.setattr(transforms, "_erfa", None)
    product = _product()

    capability = product.eci_conversion_summary()
    assert capability["route_available"] is True
    assert capability["iau2006_2000a_available"] is False
    assert capability["available"] is False
    assert "pyerfa/SOFA" in capability["reason"]
    with pytest.raises(PreciseProductImportError, match="pyerfa/SOFA"):
        product.eci_state_at("G01", datetime(2026, 7, 26, 0, 0, 18, tzinfo=UTC))
    with pytest.raises(PreciseProductImportError, match="pyerfa/SOFA"):
        _product(require_eci=True)


def test_high_rigor_eci_requires_a_versioned_hashed_unexpired_leap_snapshot():
    uploads = (
        _upload("IGS0OPSFIN_20262070000_01D_05M_ORB.SP3", _sp3_text()),
        _upload("IGS0OPSFIN_20262070000_01D_ERP.ERP", _erp_text()),
    )

    with pytest.raises(PreciseProductImportError, match="tabla de segundos intercalares local, versionada"):
        import_precise_product(uploads, require_eci=True)

    # Normal terrestrial import remains usable, but does not pretend that the
    # built-in open-ended leap table proves an externally current UTC relation.
    product = import_precise_product(uploads)
    assert product.payload()["time_validation"]["leap_seconds"]["external_freshness"] == "unverified"
    with pytest.raises(PreciseProductImportError, match="tabla de segundos intercalares local, versionada"):
        product.eci_state_at("G01", datetime(2026, 7, 26, 0, 0, 18, tzinfo=UTC))
    with pytest.raises(FrameTransformationError, match="tabla de segundos intercalares local, versionada"):
        product.provider_for_satellite("G01").state_at(
            datetime(2026, 7, 26, 0, 0, 18, tzinfo=UTC),
            target_frame=FrameId.EME2000,
        )


def test_product_bound_precise_eci_rejects_an_explicit_eop_override():
    product = _product(require_eci=True)
    native = product.provider_for_satellite("G01").native_state_at(
        datetime(2026, 7, 26, 0, 0, 18, tzinfo=UTC),
    )

    with pytest.raises(FrameTransformationError, match="no se admite un EarthOrientation explícito"):
        product.sp3.frame_transformer.transform(
            native,
            target_frame=FrameId.EME2000,
            earth_orientation=EarthOrientation(
                source="caller override",
                version="unsafe",
                quality="final",
            ),
        )


def test_imported_sp3_provider_cannot_bypass_the_no_erp_eci_contract():
    """The provider is a public runtime route, not only an implementation detail.

    OrbitRuntime retains this product-bound provider when it registers the
    selected GNSS layer.  Calling it directly must therefore have the same ERP
    guard as ``PreciseProduct.eci_state_at``.
    """

    product = import_precise_product((
        _upload("IGS0OPSFIN_20262070000_01D_05M_ORB.SP3", _sp3_text()),
    ))

    with pytest.raises(FrameTransformationError, match="Debe proporcionar un fichero ERP"):
        product.provider_for_satellite("G01").state_at(
            datetime(2026, 7, 26, 0, 0, 18, tzinfo=UTC),
            target_frame=FrameId.EME2000,
        )


def test_imported_sp3_provider_rejects_a_requested_epoch_outside_partial_erp_coverage():
    # This product can legitimately retain a short ERP when no ECI operation
    # was requested at import time.  Its public provider must still reject an
    # ECI request beyond that ERP window before attempting a frame reduction.
    product = _product(erp_text=_erp_text(end_mjd=61247.0005))

    with pytest.raises(FrameTransformationError, match="no cubre la época solicitada"):
        product.provider_for_satellite("G01").state_at(
            datetime(2026, 7, 26, 0, 1, 18, tzinfo=UTC),
            target_frame=FrameId.EME2000,
        )


def test_sp3_gps_coverage_uses_the_transformers_pinned_leap_second_table():
    """A product must not re-render its GPS coverage using the global table."""

    pinned = LeapSecondTable(
        entries=((datetime(2025, 1, 1, tzinfo=UTC), 38),),
        source="fixture leap-second table",
        version="fixture-38",
        expires_at=datetime(2027, 1, 1, tzinfo=UTC),
        sha256="a" * 64,
    )
    product = import_precise_product(
        (
            _upload(
                "IGS0OPSFIN_20262070000_01D_05M_ORB.SP3",
                _sp3_text(time_scale="GPS", epoch_second=19),
            ),
        ),
        frame_transformer=FrameTransformService(leap_second_table=pinned),
    )

    start, end = product.coverage_utc()
    assert start == datetime(2026, 7, 26, tzinfo=UTC)
    assert end == datetime(2026, 7, 26, 0, 1, tzinfo=UTC)
    assert product.payload()["start_time"] == "2026-07-26T00:00:00+00:00"
    assert product.satellite_payload("G01")["sp3"]["start_time"] == "2026-07-26T00:00:00+00:00"
    audit = product.payload()["time_validation"]
    assert audit["status"] == "passed_before_persistence"
    assert audit["declared_time_scale"] == "GPS"
    assert audit["source_to_utc_round_trip"] == {
        "status": "passed",
        "tolerance_seconds": 1.0e-6,
        "scope": "cada época SP3 distinta",
        "checked_epoch_count": 2,
    }
    assert audit["leap_seconds"] == {
        "source": "fixture leap-second table",
        "version": "fixture-38",
        "sha256": "a" * 64,
        "last_effective_at": "2025-01-01T00:00:00+00:00",
        "expires_at": "2027-01-01T00:00:00+00:00",
        "publisher_validity_horizon_present": True,
        "external_freshness": "verified",
        "external_freshness_reason": None,
    }


def test_sp3_import_rejects_an_expired_pinned_leap_second_table_before_persisting():
    expired = LeapSecondTable(
        entries=((datetime(2017, 1, 1, tzinfo=UTC), 37),),
        source="expired fixture leap-second table",
        version="fixture-expired",
        expires_at=datetime(2026, 7, 25, tzinfo=UTC),
        sha256="b" * 64,
    )

    with pytest.raises(PreciseProductImportError, match="tabla de segundos intercalares activa"):
        import_precise_product(
            (
                _upload(
                    "IGS0OPSFIN_20262070000_01D_05M_ORB.SP3",
                    _sp3_text(time_scale="GPS"),
                ),
            ),
            frame_transformer=FrameTransformService(leap_second_table=expired),
        )
