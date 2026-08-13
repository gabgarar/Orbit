"""End-to-end contracts for durable local GNSS precise products.

The compact fixture below is deliberately kept in the test suite: CI must
exercise the complete dialog-to-runtime flow without depending on the
developer-only ``../SP3`` directory or any network product catalogue.  A
separate, opt-in smoke test can be used locally with the real CODE MGEX
bundle when that directory is available.
"""

from __future__ import annotations

import base64
import gzip
import os
from pathlib import Path

import pytest
from orbit_api.application.orbit_runtime import OrbitRuntime

_EPOCHS = (
    "*  2026 07 26 00 00 18.00000000",
    "*  2026 07 26 00 01 18.00000000",
)
_LOCAL_PRODUCT_DIRECTORY = Path(__file__).resolve().parents[5] / "SP3"
_LOCAL_PRODUCT_FILENAMES = (
    "COD0MGXFIN_20251310000_01D_05M_ORB.SP3.gz",
    "COD0MGXFIN_20251310000_01D_30S_CLK.CLK.gz",
    "COD0MGXFIN_20251310000_01D_12H_ERP.ERP.gz",
    "COD0MGXFIN_20251310000_01D_30S_ATT.OBX.gz",
    "COD0MGXFIN_20251310000_01D_01D_OSB.BIA.gz",
)


def _position(satellite_id: str, x_km: float, y_km: float, z_km: float) -> str:
    return f"P{satellite_id}{x_km:14.6f}{y_km:14.6f}{z_km:14.6f}{0.123456:14.6f}"


def _compact_sp3() -> str:
    """Return a strict, three-member SP3 fixture with a stable subset target."""

    first = (
        _position("G01", 7000.0, 100.0, 10.0),
        _position("C06", 26000.0, 200.0, 20.0),
        _position("E02", 23000.0, 300.0, 30.0),
    )
    second = (
        _position("G01", 7060.0, 101.0, 11.0),
        _position("C06", 26060.0, 201.0, 21.0),
        _position("E02", 23060.0, 301.0, 31.0),
    )
    return "\n".join((
        "#cP2026 07 26 00 00 18.00000000       2 ORBIT ITRF  FIT COD",
        "## 0000 0 60.00000000 0 0",
        "+    3   G01C06E02",
        "%c cc UTC ccc ccc ccc ccc ccc ccc ccc ccc ccc ccc ccc ccc",
        _EPOCHS[0],
        *first,
        _EPOCHS[1],
        *second,
    ))


def _compact_clk() -> str:
    return (
        "     3.04           C                   RINEX VERSION / TYPE\n"
        "GPS                                                         TIME SYSTEM ID\n"
        "                                                            END OF HEADER\n"
        "AS G01 2026 07 26 00 00 18.0000000  2  1.234567890D-04  2.0D-12\n"
        "AS C06 2026 07 26 00 00 18.0000000  2  2.234567890D-04  2.0D-12\n"
        "AS E02 2026 07 26 00 00 18.0000000  2  3.234567890D-04  2.0D-12"
    )


def _compact_erp() -> str:
    return (
        "VERSION 2\n"
        "MJD Xpole Ypole UT1-UTC LOD Xsig Ysig UTsig LODsig Nr Nf Nt Xrt Yrt\n"
        "61247.00000000 100000 -200000 2500000 10000 0 0 0 0 0 0 0 0 0\n"
        "61248.00000000 120000 -180000 2600000 11000 0 0 0 0 0 0 0 0 0"
    )


def _encoded_gzip(name: str, text: str) -> tuple[str, str]:
    return name, base64.b64encode(gzip.compress(text.encode("utf-8"))).decode("ascii")


def _reproducible_product_uploads() -> list[tuple[str, str]]:
    """All supported companion slots in their normal compressed transport form."""

    return [
        _encoded_gzip("COD0MGXFIN_20251310000_01D_05M_ORB.SP3.gz", _compact_sp3()),
        _encoded_gzip("COD0MGXFIN_20251310000_01D_30S_CLK.CLK.gz", _compact_clk()),
        _encoded_gzip("COD0MGXFIN_20251310000_01D_12H_ERP.ERP.gz", _compact_erp()),
        _encoded_gzip("COD0MGXFIN_20251310000_01D_SUM.SUM.gz", "CODE MGEX fixture summary"),
        _encoded_gzip("COD0MGXFIN_20251310000_01D_30S_ATT.ATT.OBX.gz", "attitude fixture"),
        _encoded_gzip("COD0MGXFIN_20251310000_01D_01D_OSB.OSB.BIA.gz", "bias fixture"),
    ]


def _reload_runtime_without_an_external_tle_catalog(monkeypatch, storage: Path) -> OrbitRuntime:
    monkeypatch.setattr(
        "orbit_api.application.orbit_runtime.load_system_config",
        lambda: ({}, {"satellites_catalog_file": "catalog.json"}),
    )
    monkeypatch.setattr(
        "orbit_api.application.orbit_runtime.load_all_tles_from_config",
        lambda _path: [],
    )
    runtime = OrbitRuntime(precise_products_dir=storage)
    runtime.load_constellation()
    return runtime


def test_gnss_product_preview_subset_import_restart_and_detail_contract(tmp_path, monkeypatch):
    """A cancel-safe preview becomes exactly one durable selected GNSS layer.

    This covers the same lifecycle the UI uses: all source slots are parsed,
    a user sees every SP3 member, imports only one member, then obtains the
    same layer and source-derived details after a process restart.
    """

    storage = tmp_path / "precise-products"
    uploads = _reproducible_product_uploads()
    runtime = OrbitRuntime(precise_products_dir=storage)

    preview = runtime.preview_precise_product(uploads).preview_payload()

    assert preview["product"]["persistence"] == {"scope": "preview", "reloadable": False}
    assert [item["satellite_id"] for item in preview["satellites"]] == ["G01", "C06", "E02"]
    assert [item["constellation"] for item in preview["satellites"]] == ["GPS", "BeiDou", "Galileo"]
    assert not storage.exists()
    assert runtime.precise_products_payload() == {"items": [], "diagnostics": []}

    imported = runtime.import_precise_product(uploads, selected_satellite_ids=["c06"])
    runtime_id = imported.runtime_id("C06")
    response = runtime.precise_product_import_payload(imported)
    product = response["product"]
    detail = response["satellites"][0]

    assert imported.satellite_ids == ("C06",)
    assert response["importedIds"] == [runtime_id]
    assert product["provider_id"] == "igs_mgex"
    assert product["product_class"] == "final"
    assert product["product_family"] == "mgex"
    assert product["satellite_ids"] == ["C06"]
    assert product["selected_satellite_ids"] == ["C06"]
    assert {source["kind"] for source in product["source_files"]} == {
        "sp3", "clk", "erp", "sum", "att", "osb",
    }
    assert {source["compression"] for source in product["source_files"]} == {"gzip"}
    assert product["erp"]["present"] is True
    assert product["companions"] == {
        "sum": "COD0MGXFIN_20251310000_01D_SUM.SUM",
        "att": "COD0MGXFIN_20251310000_01D_30S_ATT.ATT.OBX",
        "osb": "COD0MGXFIN_20251310000_01D_01D_OSB.OSB.BIA",
    }
    assert detail["id"] == runtime_id
    assert detail["display_name"] == "C06"
    assert detail["norad"] is None
    assert detail["catalogMeta"] == {
        "sourceFormat": "SP3",
        "provider_id": "igs_mgex",
        "product_class": "final",
        "product_family": "mgex",
        "detected_product_family": "mgex",
    }
    assert detail["sp3"]["sample_count"] == 2
    assert detail["sp3"]["sample_cadence_seconds"] == 60.0
    assert detail["sp3"]["clock"]["rinex_clk"]["sample_count"] == 1
    assert detail["sp3"]["erp"]["present"] is True

    restarted = _reload_runtime_without_an_external_tle_catalog(monkeypatch, storage)
    hydrated = restarted.precise_products_payload()

    assert hydrated["diagnostics"] == []
    assert len(hydrated["items"]) == 1
    assert hydrated["items"][0]["product"]["id"] == imported.product_id
    assert hydrated["items"][0]["product"]["selected_satellite_ids"] == ["C06"]
    assert hydrated["items"][0]["importedIds"] == [runtime_id]
    hydrated_detail = hydrated["items"][0]["satellites"][0]
    assert hydrated_detail["id"] == runtime_id
    assert hydrated_detail["sp3"]["sample_count"] == detail["sp3"]["sample_count"]
    assert restarted.resolve_propagator(runtime_id, None, None)[0] == runtime_id


def test_gnss_product_complete_import_registers_every_previewed_member(tmp_path):
    """Omitting a selection intentionally persists every SP3 member."""

    runtime = OrbitRuntime(precise_products_dir=tmp_path / "precise-products")
    imported = runtime.import_precise_product(_reproducible_product_uploads())
    payload = runtime.precise_product_import_payload(imported)

    assert imported.satellite_ids == ("G01", "C06", "E02")
    assert imported.selected_satellite_ids == ("G01", "C06", "E02")
    assert payload["product"]["satellite_count"] == 3
    assert payload["product"]["selected_satellite_ids"] == ["G01", "C06", "E02"]
    assert payload["importedIds"] == [
        imported.runtime_id("G01"),
        imported.runtime_id("C06"),
        imported.runtime_id("E02"),
    ]
    assert [item["display_name"] for item in payload["satellites"]] == ["G01", "C06", "E02"]


def _local_product_smoke_is_enabled() -> bool:
    """Keep real-product validation explicit and outside normal/CI test runs."""

    return os.environ.get("ORBIT_RUN_LOCAL_SP3_SMOKE") == "1" and all(
        (_LOCAL_PRODUCT_DIRECTORY / name).is_file() for name in _LOCAL_PRODUCT_FILENAMES
    )


@pytest.mark.skipif(
    not _local_product_smoke_is_enabled(),
    reason=(
        "Smoke real local desactivado; requiere ORBIT_RUN_LOCAL_SP3_SMOKE=1 "
        "y ../SP3 con el paquete CODE MGEX."
    ),
)
def test_local_code_mgex_bundle_imports_all_available_companions_and_a_subset(tmp_path):
    """Opt-in smoke for the real local bundle; never required by CI."""

    uploads = [
        (name, base64.b64encode((_LOCAL_PRODUCT_DIRECTORY / name).read_bytes()).decode("ascii"))
        for name in _LOCAL_PRODUCT_FILENAMES
    ]
    runtime = OrbitRuntime(precise_products_dir=tmp_path / "precise-products")

    imported = runtime.import_precise_product(uploads, selected_satellite_ids=["G01"])
    payload = runtime.precise_product_import_payload(imported)

    assert imported.satellite_ids == ("G01",)
    assert {source["kind"] for source in payload["product"]["source_files"]} == {
        "sp3", "clk", "erp", "att", "osb",
    }
    assert payload["product"]["frame"] == "IGB20"
    assert payload["product"]["time_scale"] == "GPS"
    assert payload["satellites"][0]["sp3"]["sample_count"] > 200
    assert payload["satellites"][0]["norad"] is None
