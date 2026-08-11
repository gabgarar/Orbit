"""Deterministic mutation corpus for fail-closed GNSS precise imports.

These tests deliberately use a compact, valid SP3/ERP pair and mutate exactly
one structural or numerical property at a time.  They are not random fuzzing:
each named case documents an input family that must always be rejected before
Orbit can build, persist, or register a precise-product state.
"""

from __future__ import annotations

import base64

import pytest
from orbit_api.application.orbit_runtime import OrbitRuntime
from orbit_api.application.precise_products import PreciseProductImportError
from orbit_api.formats import EphemerisFormatError, parse_sp3_state_provider
from orbit_api.timekeeping import (
    EopSnapshotValidationError,
    IgsErpEarthOrientationProvider,
)

_FIRST_EPOCH = "*  2026 07 26 00 00 18.00000000"
_SECOND_EPOCH = "*  2026 07 26 00 01 18.00000000"


def _sp3_position(
    satellite_id: str,
    x_km: float,
    y_km: float = 0.0,
    z_km: float = 0.0,
    clock_microseconds: float = 0.123456,
) -> str:
    """Return one fixed-width SP3 P record accepted by strict ingestion."""

    return (
        f"P{satellite_id}{x_km:14.6f}{y_km:14.6f}{z_km:14.6f}"
        f"{clock_microseconds:14.6f}"
    )


def _valid_sp3() -> str:
    return "\n".join((
        "#cP2026 07 26 00 00 18.00000000       2 ORBIT ITRF  FIT COD ",
        "## 0000 0 60.00000000 0 0",
        "+    1   G01",
        "%c cc UTC ccc ccc ccc ccc ccc ccc ccc ccc ccc ccc ccc ccc",
        _FIRST_EPOCH,
        _sp3_position("G01", 7000.0),
        _SECOND_EPOCH,
        _sp3_position("G01", 7060.0),
    ))


def _valid_erp() -> str:
    return (
        "VERSION 2\n"
        "MJD Xpole Ypole UT1-UTC LOD\n"
        "61247.00000000 100000 -200000 2500000 10000\n"
        "61248.00000000 120000 -180000 2600000 11000"
    )


def _mutated_sp3(case: str) -> str:
    """Produce one reproducible corrupt-SP3 input by name."""

    lines = _valid_sp3().splitlines()
    if case == "bad-header-prefix":
        lines[0] = "!" + lines[0][1:]
    elif case == "truncated-header":
        lines[0] = lines[0][:32]
    elif case == "missing-cadence":
        del lines[1]
    elif case == "nonfinite-cadence":
        lines[1] = "## 0000 0 NaN 0 0"
    elif case == "truncated-epoch-table":
        del lines[-2:]
    elif case == "state-before-first-epoch":
        lines.insert(4, _sp3_position("G01", 7000.0))
    elif case == "truncated-position-record":
        lines[5] = "PG01 7000.0"
    elif case == "nonnumeric-position-component":
        lines[5] = (
            f"PG01{'not-a-number':>14}{0.0:14.6f}{0.0:14.6f}{0.123456:14.6f}"
        )
    elif case == "nonfinite-position-component":
        lines[5] = _sp3_position("G01", float("nan"))
    elif case == "duplicate-epoch":
        lines[6] = _FIRST_EPOCH
    elif case == "duplicate-position-record":
        lines.insert(6, lines[5])
    elif case == "unexpected-position-member":
        lines.insert(6, _sp3_position("G02", 7100.0))
    elif case == "duplicate-header-member":
        lines[2] = "+    2   G01G01"
    elif case == "unsupported-time-scale":
        lines[3] = "%c cc XYZ ccc ccc ccc ccc ccc ccc ccc ccc ccc ccc ccc ccc"
    else:  # pragma: no cover - protects future corpus maintenance.
        raise AssertionError(f"Mutación SP3 desconocida: {case}")
    return "\n".join(lines)


def _mutated_erp(case: str) -> str:
    """Produce one reproducible corrupt-ERP input by name."""

    lines = _valid_erp().splitlines()
    if case == "truncated-file":
        del lines[2:]
    elif case == "missing-required-column":
        lines[1] = "MJD Xpole Ypole UT1-UTC"
    elif case == "truncated-row":
        lines[2] = "61247.00000000 100000 -200000 2500000"
    elif case == "nonnumeric-row":
        lines[2] = "61247.00000000 broken -200000 2500000 10000"
    elif case == "nonfinite-row":
        lines[2] = "61247.00000000 NaN -200000 2500000 10000"
    elif case == "duplicate-mjd":
        lines[3] = "61247.00000000 120000 -180000 2600000 11000"
    elif case == "nonmonotonic-mjd":
        lines[2], lines[3] = lines[3], lines[2]
    elif case == "out-of-range-polar-motion":
        lines[2] = "61247.00000000 1000001 -200000 2500000 10000"
    else:  # pragma: no cover - protects future corpus maintenance.
        raise AssertionError(f"Mutación ERP desconocida: {case}")
    return "\n".join(lines)


def _upload(name: str, text: str) -> tuple[str, str]:
    return name, base64.b64encode(text.encode("utf-8")).decode("ascii")


@pytest.mark.parametrize(
    ("case", "message"),
    (
        ("bad-header-prefix", "debe empezar"),
        ("truncated-header", "cabecera SP3"),
        ("missing-cadence", "línea ##"),
        ("nonfinite-cadence", "cadencia ##"),
        ("truncated-epoch-table", "número de épocas SP3"),
        ("state-before-first-epoch", "antes de su primera época"),
        ("truncated-position-record", "columnas cartesianas"),
        ("nonnumeric-position-component", "componentes no numéricos"),
        ("nonfinite-position-component", "componentes no finitos"),
        ("duplicate-epoch", "duplicadas o no crecientes"),
        ("duplicate-position-record", "registro P duplicado"),
        ("unexpected-position-member", "satélites de una época SP3"),
        ("duplicate-header-member", "satélites duplicados"),
        ("unsupported-time-scale", "escala temporal no soportada"),
    ),
)
def test_strict_sp3_mutation_corpus_fails_closed_before_a_provider_is_created(
    case: str,
    message: str,
):
    """Every malformed SP3 corpus member fails before a provider can escape."""

    with pytest.raises(EphemerisFormatError, match=message):
        parse_sp3_state_provider(_mutated_sp3(case), strict_structure=True)


@pytest.mark.parametrize(
    ("case", "message"),
    (
        ("truncated-file", "no contiene registros"),
        ("missing-required-column", "debe declarar las columnas"),
        ("truncated-row", "fila incompleta o no numérica"),
        ("nonnumeric-row", "fila incompleta o no numérica"),
        ("nonfinite-row", "valores no finitos"),
        ("duplicate-mjd", "sin épocas repetidas"),
        ("nonmonotonic-mjd", "ordenado cronológicamente"),
        ("out-of-range-polar-motion", "Xpole fuera del rango físico"),
    ),
)
def test_erp_mutation_corpus_fails_closed_before_an_orientation_provider_is_created(
    case: str,
    message: str,
):
    """ERP corruption cannot produce a partially valid EOP provider."""

    with pytest.raises(EopSnapshotValidationError, match=message):
        IgsErpEarthOrientationProvider.from_text(_mutated_erp(case))


@pytest.mark.parametrize(
    ("kind", "case"),
    (
        ("sp3", "truncated-epoch-table"),
        ("sp3", "nonfinite-position-component"),
        ("sp3", "duplicate-position-record"),
        ("erp", "truncated-row"),
        ("erp", "nonfinite-row"),
        ("erp", "duplicate-mjd"),
    ),
)
def test_rejected_mutation_never_persists_or_registers_a_precise_product(
    tmp_path,
    kind: str,
    case: str,
):
    """The runtime must remain empty after any parse-stage import rejection."""

    storage = tmp_path / "precise-products"
    runtime = OrbitRuntime(precise_products_dir=storage)
    uploads = [
        _upload(
            "IGS0OPSFIN_20262070000_01D_05M_ORB.SP3",
            _mutated_sp3(case) if kind == "sp3" else _valid_sp3(),
        ),
    ]
    if kind == "erp":
        uploads.append(
            _upload(
                "IGS0OPSFIN_20262070000_01D_ERP.ERP",
                _mutated_erp(case),
            )
        )

    before = runtime.precise_products_payload()
    with pytest.raises(PreciseProductImportError):
        runtime.import_precise_product(uploads)

    assert runtime.precise_products_payload() == before == {"items": [], "diagnostics": []}
    assert not storage.exists()
    _properties, _configuration, propagators = runtime.get_state_snapshot()
    assert not any(name.startswith("precise:") for name in propagators)
