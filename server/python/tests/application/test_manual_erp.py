"""Security and route contracts for an ERP attached to one manual orbit."""

from __future__ import annotations

import base64
import gzip
import json
from datetime import UTC, datetime, timedelta

import pytest
from fastapi import HTTPException

from orbit_api.api.routes.manual_orbits import create_manual_orbits_router
from orbit_api.application.manual_erp import (
    ManualErpError,
    ManualErpRepository,
    parse_manual_erp_upload,
)
from orbit_api.application.manual_orbits import (
    ManualOrbitError,
    manual_erp_frame_transformer,
)
from orbit_api.application.orbit_parameters import build_orbit_parameters
from orbit_api.domain.requests import (
    ManualErpPreviewRequest,
    ManualOrbitRequest,
    OrbitParametersRequest,
)
from orbit_api.frames import FrameTransformService, FrameTransformationError
from orbit_api.orbits.forces import GravityFieldModel
from orbit_api.timekeeping import (
    EarthOrientation,
    IgsErpEarthOrientationProvider,
    LeapSecondTable,
    StaticEarthOrientationProvider,
    VisualApproximationEarthOrientationProvider,
)


_EPOCH = datetime(2026, 7, 20, 12, tzinfo=UTC)


def _erp_text(*, start_mjd: float = 61240.0, end_mjd: float = 61243.0) -> str:
    """Small physically valid IGS ERP v2 table covering the fixture epoch."""

    return "\n".join((
        "VERSION 2",
        "MJD Xpole Ypole UT1-UTC LOD",
        f"{start_mjd:.8f} 100000 -200000 2500000 10000",
        f"{end_mjd:.8f} 120000 -180000 2600000 11000",
    ))


def _encoded(text: str) -> str:
    return base64.b64encode(text.encode("utf-8")).decode("ascii")


def _manual_payload(*, force_terms: list[str] | None = None, **overrides) -> dict:
    payload = {
        "name": "Manual ERP test",
        "epochUtc": _EPOCH.isoformat(),
        "propagator": "cowell-rk4" if force_terms else "two-body",
        "keplerian": {
            "semiMajorAxisKm": 7000.0,
            "eccentricity": 0.01,
            "inclinationDeg": 51.6,
            "raanDeg": 20.0,
            "argumentOfPeriapsisDeg": 45.0,
            "trueAnomalyDeg": 15.0,
        },
    }
    if force_terms is not None:
        payload["propagationOptions"] = {"forceTerms": force_terms}
    payload.update(overrides)
    return payload


@pytest.fixture
def repository_and_snapshot(tmp_path):
    repository = ManualErpRepository(tmp_path / "manual-erp-snapshots")
    snapshot = repository.save_upload("operator.erp", _encoded(_erp_text()))
    return repository, snapshot


def _endpoint(router, path: str):
    return next(route.endpoint for route in router.routes if route.path == path)


def _automatic_iers_transformer() -> FrameTransformService:
    """Deterministic stand-in for the process-wide automatic IERS route."""

    return FrameTransformService(
        StaticEarthOrientationProvider(
            EarthOrientation(
                dut1_seconds=0.17,
                xp_radians=1.0e-6,
                yp_radians=-0.8e-6,
                source="IERS automatic test provider",
                version="test-c01",
                quality="final",
            )
        ),
        leap_second_table=LeapSecondTable(
            entries=((datetime(2025, 1, 1, tzinfo=UTC), 38),),
            source="test leap seconds",
            version="test-2025",
            sha256="a" * 64,
            expires_at=datetime(2027, 1, 1, tzinfo=UTC),
        ),
    )


def _nominal_transformer() -> FrameTransformService:
    """Deterministic missing-IERS state with an explicit nominal fallback."""

    return FrameTransformService(
        VisualApproximationEarthOrientationProvider(),
        leap_second_table=LeapSecondTable(
            entries=((datetime(2025, 1, 1, tzinfo=UTC), 38),),
            source="test leap seconds",
            version="test-2025",
            sha256="c" * 64,
            expires_at=datetime(2027, 1, 1, tzinfo=UTC),
        ),
    )


def test_manual_erp_snapshot_is_content_addressed_reloadable_and_never_returns_bytes(
    repository_and_snapshot,
):
    repository, snapshot = repository_and_snapshot

    payload = snapshot.payload()
    assert payload["snapshotId"].startswith("manual-erp:sha256:")
    assert payload["quality"] == "local-validated"
    assert payload["coverage_start"] == snapshot.coverage_start.isoformat()
    assert payload["coverage_end"] == snapshot.coverage_end.isoformat()
    assert "content_base64" not in payload
    assert "contentBase64" not in payload
    assert _erp_text() not in repr(payload)

    restored = repository.load(snapshot.snapshot_id)
    assert restored.snapshot_id == snapshot.snapshot_id
    assert restored.provider.at(_EPOCH).quality == "local-validated"


def test_manual_erp_accepts_gzip_but_rejects_invalid_structural_or_physical_data(tmp_path):
    repository = ManualErpRepository(tmp_path / "manual-erp-snapshots")
    compressed = base64.b64encode(gzip.compress(_erp_text().encode("utf-8"))).decode("ascii")
    snapshot = repository.save_upload("operator.erp.gz", compressed)
    assert snapshot.filename == "operator.erp"

    invalid = "\n".join((
        "VERSION 2",
        "MJD Xpole Ypole UT1-UTC LOD",
        "61240.00000000 999999999 -200000 2500000 10000",
    ))
    with pytest.raises(ManualErpError):
        parse_manual_erp_upload("unsafe.erp", _encoded(invalid))


def test_manual_erp_snapshot_detects_tampering_on_restore(repository_and_snapshot):
    repository, snapshot = repository_and_snapshot
    digest = snapshot.snapshot_id.rsplit(":", 1)[-1]
    (repository.root / digest / "source.erp").write_text("tampered", encoding="utf-8")

    with pytest.raises(ManualErpError, match="checksum"):
        repository.load(snapshot.snapshot_id)


def test_manual_erp_snapshot_rechecks_its_persisted_parser_identity(repository_and_snapshot):
    repository, snapshot = repository_and_snapshot
    digest = snapshot.snapshot_id.rsplit(":", 1)[-1]
    manifest_path = repository.root / digest / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["record_count"] = 99
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")

    with pytest.raises(ManualErpError, match="interpretación validada"):
        repository.load(snapshot.snapshot_id)


def test_time_preview_persists_only_compact_provenance_and_proposes_exact_coverage(
    tmp_path,
):
    repository = ManualErpRepository(tmp_path / "manual-erp-snapshots")
    router = create_manual_orbits_router(lambda *_args: {"points": []}, lambda value: value, manual_erp_repository=repository)
    preview = _endpoint(router, "/manual-orbits/time/erp-preview")
    request = ManualErpPreviewRequest.model_validate({
        "manualErp": {"name": "operator.erp", "contentBase64": _encoded(_erp_text())},
        "designWindow": {
            "startTime": _EPOCH.isoformat(),
            "endTime": (_EPOCH + timedelta(hours=2)).isoformat(),
        },
        "sceneWindow": {
            "startTime": (_EPOCH - timedelta(days=2)).isoformat(),
            "endTime": (_EPOCH + timedelta(days=5)).isoformat(),
        },
    })

    response = preview(request)

    assert response["ok"] is True
    assert response["manualErp"]["snapshotId"].startswith("manual-erp:sha256:")
    assert "content_base64" not in response["manualErp"]
    assert "contentBase64" not in response["manualErp"]
    assert response["suggestedDesignWindow"]["startTime"] == response["manualErp"]["coverage_start"]
    assert response["suggestedDesignWindow"]["endTime"] == response["manualErp"]["coverage_end"]
    assert response["sceneAlignment"]["relation"] == "inside-scene"


@pytest.mark.parametrize("force_terms", (["drag"], ["geopotential"]))
def test_earth_fixed_manual_forces_use_automatic_iers_without_an_attached_erp(force_terms):
    calls = []
    router = create_manual_orbits_router(
        lambda *_args: calls.append("build") or {"points": []},
        lambda value: value,
        frame_transformer=_automatic_iers_transformer(),
        gravity_field=(None if force_terms == ["drag"] else GravityFieldModel.wgs84_zonal_degree4()),
    )
    create = _endpoint(router, "/manual-orbits")

    response = create(ManualOrbitRequest(**_manual_payload(force_terms=force_terms)))

    assert calls == ["build"]
    assert response["manualErp"] is None
    assert "IERS EOP automatic" in response["propagator_metadata"]["earth_fixed_force_route"]
    assert response["propagator_metadata"]["earth_orientation_status"] == "iers"


def test_earth_fixed_manual_force_warns_and_uses_nominal_rotation_when_iers_is_missing():
    router = create_manual_orbits_router(
        lambda *_args: {"points": []},
        lambda value: value,
        frame_transformer=_nominal_transformer(),
    )

    response = _endpoint(router, "/manual-orbits")(
        ManualOrbitRequest(**_manual_payload(force_terms=["drag"]))
    )

    metadata = response["propagator_metadata"]
    assert metadata["earth_orientation_status"] == "nominal"
    assert metadata["warnings"] == [
        "No hay datos ERP disponibles. El geopotencial y el arrastre atmosférico "
        "usarán una rotación terrestre nominal."
    ]


def test_central_manual_orbit_still_creates_without_erp():
    calls = []
    router = create_manual_orbits_router(
        lambda *_args: calls.append("build") or {"points": []},
        lambda value: value,
    )

    response = _endpoint(router, "/manual-orbits")(ManualOrbitRequest(**_manual_payload()))

    assert calls == ["build"]
    assert response["manualErp"] is None


def test_inspector_uses_automatic_global_eop_for_earth_fixed_force():
    request = OrbitParametersRequest.model_validate({
        "source": {"kind": "manual", "manualOrbit": _manual_payload(force_terms=["drag"])},
        "startTime": _EPOCH.isoformat(),
        "endTime": (_EPOCH + timedelta(minutes=10)).isoformat(),
        "samples": 2,
    })

    response = build_orbit_parameters(
        request,
        resolve_propagator=lambda *_args: (_ for _ in ()).throw(AssertionError("manual")),
        frame_transformer=_automatic_iers_transformer(),
    )

    assert response["model"]["earth_orientation_status"] == "iers"
    assert response["source"]["manual_erp"] is None


def test_manual_force_snapshot_reference_fails_closed_when_local_file_is_missing(tmp_path):
    repository = ManualErpRepository(tmp_path / "manual-erp-snapshots")
    router = create_manual_orbits_router(
        lambda *_args: {"points": []},
        lambda value: value,
        manual_erp_repository=repository,
    )
    request = ManualOrbitRequest(**_manual_payload(
        force_terms=["drag"],
        manualErp={"snapshotId": f"manual-erp:sha256:{'a' * 64}"},
    ))

    with pytest.raises(HTTPException, match="vuelva a adjuntar") as rejected:
        _endpoint(router, "/manual-orbits")(request)

    assert rejected.value.status_code == 422


def test_executable_manual_route_rejects_base64_and_requires_time_preflight(tmp_path):
    repository = ManualErpRepository(tmp_path / "manual-erp-snapshots")
    router = create_manual_orbits_router(
        lambda *_args: {"points": []},
        lambda value: value,
        manual_erp_repository=repository,
    )
    request = ManualOrbitRequest(**_manual_payload(
        force_terms=["drag"],
        manualErp={"name": "operator.erp", "contentBase64": _encoded(_erp_text())},
    ))

    with pytest.raises(HTTPException, match="pestaña TIME") as rejected:
        _endpoint(router, "/manual-orbits")(request)

    assert rejected.value.status_code == 422
    assert list(repository.root.glob("*")) == []


def test_manual_force_uses_its_snapshot_not_global_eop_and_requires_full_window_coverage(
    repository_and_snapshot,
):
    repository, snapshot = repository_and_snapshot
    calls = []
    router = create_manual_orbits_router(
        lambda *_args: calls.append("build") or {"points": []},
        lambda value: value,
        manual_erp_repository=repository,
    )
    create = _endpoint(router, "/manual-orbits")
    accepted = create(ManualOrbitRequest(**_manual_payload(
        force_terms=["drag"],
        manualErp={"snapshotId": snapshot.snapshot_id},
        startTime=_EPOCH.isoformat(),
        endTime=(_EPOCH + timedelta(hours=2)).isoformat(),
    )))

    assert calls == ["build"]
    assert accepted["manualErp"]["snapshotId"] == snapshot.snapshot_id
    assert "manual_erp_required" not in accepted["propagator_metadata"]
    assert accepted["propagator_metadata"]["manual_erp_snapshot_id"] == snapshot.snapshot_id
    assert "contentBase64" not in accepted["manualErp"]

    outside = ManualOrbitRequest(**_manual_payload(
        force_terms=["drag"],
        manualErp={"snapshotId": snapshot.snapshot_id},
        startTime="2026-07-24T00:00:00Z",
        endTime="2026-07-24T01:00:00Z",
    ))
    with pytest.raises(HTTPException, match="no cubre") as rejected:
        create(outside)
    assert rejected.value.status_code == 422
    assert calls == ["build"]


def test_manual_force_checks_the_hidden_epoch_to_design_window_leg(
    repository_and_snapshot,
):
    repository, snapshot = repository_and_snapshot
    calls = []
    router = create_manual_orbits_router(
        lambda *_args: calls.append("build") or {"points": []},
        lambda value: value,
        manual_erp_repository=repository,
    )
    # The requested window is covered, but a Cowell propagation begins at its
    # definition epoch. Allowing this would make the first integration leg
    # extrapolate the manual ERP before the visible design window.
    request = ManualOrbitRequest(**_manual_payload(
        force_terms=["drag"],
        epochUtc="2026-07-18T12:00:00Z",
        manualErp={"snapshotId": snapshot.snapshot_id},
        startTime=_EPOCH.isoformat(),
        endTime=(_EPOCH + timedelta(hours=2)).isoformat(),
    ))

    with pytest.raises(HTTPException, match="no cubre") as rejected:
        _endpoint(router, "/manual-orbits")(request)

    assert rejected.value.status_code == 422
    assert calls == []


def test_only_the_isolated_manual_transformer_accepts_local_validated_quality(
    repository_and_snapshot,
):
    _repository, snapshot = repository_and_snapshot
    isolated = manual_erp_frame_transformer(None, snapshot.provider)
    assert isolated is not None
    assert isolated.strict_eop is True
    assert isolated.earth_orientation_at(_EPOCH).quality == "local-validated"

    global_route = FrameTransformService(snapshot.provider, strict_eop=True)
    with pytest.raises(FrameTransformationError, match="final o rapid"):
        global_route.earth_orientation_at(_EPOCH)
    generic_clone = FrameTransformService().with_earth_orientation_provider(
        snapshot.provider,
        strict_eop=True,
    )
    with pytest.raises(FrameTransformationError, match="final o rapid"):
        generic_clone.earth_orientation_at(_EPOCH)

    published = IgsErpEarthOrientationProvider.from_text(
        _erp_text(),
        filename="published.erp",
        quality="final",
    )
    with pytest.raises(ManualOrbitError, match="solo puede usar"):
        manual_erp_frame_transformer(None, published)
