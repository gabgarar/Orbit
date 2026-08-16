"""Offline safety contracts for the automatic NGA gravity-model registry."""

from __future__ import annotations

import gzip
import io
import os
import threading
import zipfile
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from pathlib import Path

import orbit_api.orbits.forces.gravity_registry as gravity_registry_module
import pytest
from orbit_api.application.manual_orbits import (
    build_manual_orbit_propagator,
    canonical_manual_orbit,
)
from orbit_api.domain.requests import ManualOrbitRequest
from orbit_api.orbits.forces.gravity_registry import (
    EGM96_SPEC,
    EGM2008_SPEC,
    GravityModelCacheError,
    GravityModelRegistry,
)

NOW = datetime(2026, 8, 14, tzinfo=UTC)


def _small_egm96_spec():
    """Keep fixtures tiny while exercising the exact EGM96 archive layout."""

    return replace(
        EGM96_SPEC,
        max_degree=3,
        max_order=3,
        archive_max_degree=3,
        complete_through_degree=3,
        tail_max_order=3,
        minimum_degree=3,
    )


def _small_egm2008_spec():
    """Exercise the real EGM2008 member name and its documented tail shape.

    The production archive is complete through 2159 x 2159 and then carries
    degrees 2160..2190 only through order 2159.  This reduced fixture keeps
    that distinction (complete through 3, degree-4 tail through order 3)
    without downloading the 109 MiB official archive in tests.
    """

    return replace(
        EGM2008_SPEC,
        max_degree=4,
        max_order=4,
        archive_max_degree=4,
        complete_through_degree=3,
        tail_max_order=3,
        minimum_degree=4,
    )


def _coefficients(*, c22: str = "0.243914352398E-05") -> bytes:
    rows = [
        "2 0 -0.484165371736E-03 0.000000000000E+00 0 0",
        "2 1 -0.186987635955E-09 0.119528012031E-08 0 0",
        f"2 2 {c22} -0.140016683654E-05 0 0",
        "3 0 0.957254173792E-06 0.000000000000E+00 0 0",
        "3 1 0.202998882184E-05 0.248513158716E-06 0 0",
        "3 2 0.904627768605E-06 -0.619025944205E-06 0 0",
        "3 3 0.721072657057E-06 0.141435626958E-05 0 0",
    ]
    return ("\n".join(rows) + "\n").encode("ascii")


def _egm2008_coefficients() -> bytes:
    """NGA-style EGM2008 rows plus a bounded representation of its tail."""

    rows = _coefficients().decode("ascii").splitlines()
    rows.extend(
        [
            "4 0 0.539965866638E-06 0.000000000000E+00 0 0",
            "4 1 -0.536157389388E-06 -0.473567346518E-06 0 0",
            "4 2 0.350501623962E-06 0.662480026275E-06 0 0",
            "4 3 0.990987118361E-06 -0.200956723567E-06 0 0",
        ]
    )
    return ("\n".join(rows) + "\n").encode("ascii")


def _archive(
    payload: bytes,
    *,
    member: str = "EGM96",
    compression: int = zipfile.ZIP_DEFLATED,
) -> bytes:
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, "w", compression=compression) as archive:
        archive.writestr(member, payload)
        archive.writestr("readme.txt", "fixture")
    return stream.getvalue()


def test_missing_egm96_download_is_validated_extracted_and_materialised(tmp_path: Path):
    raw = _archive(_coefficients())
    calls: list[tuple[str, float, int]] = []
    registry = GravityModelRegistry(
        tmp_path,
        active_model="EGM96",
        specs=(_small_egm96_spec(),),
        fetcher=lambda url, timeout, maximum: calls.append((url, timeout, maximum)) or raw,
        now=lambda: NOW,
    )

    records = registry.refresh_if_needed()
    record = records["EGM96"]

    assert len(calls) == 1
    assert record.available is True
    assert record.status == "ok"
    assert record.archive_path.exists() and record.archive_path.stat().st_size > 0
    assert record.coefficient_path.exists()
    assert record.inspection is not None
    assert record.inspection.record_count == 7
    assert record.inspection.max_degree == 3
    selection = registry.resolve_selection("EGM96", 3, 3)
    model = registry.materialize_selection(selection, max_harmonic_terms=100)
    assert model.model_id == "EGM96"
    assert model.max_degree == 3
    assert model.coefficient(2, 0)[0] == pytest.approx(-0.484165371736e-3)


def test_fresh_warm_archive_is_revalidated_and_repairs_a_missing_extracted_member_without_download(
    tmp_path: Path,
):
    """A warm NGA cache is trusted only after its ZIP is parsed again.

    The ZIP is the authoritative cache object.  A missing extracted member is
    reconstructed from that already-validated ZIP, so a normal warm startup
    stays offline while still checking both files that Orbit uses later.
    """

    spec = _small_egm96_spec()
    raw = _archive(_coefficients())
    seeded = GravityModelRegistry(
        tmp_path,
        active_model="EGM96",
        specs=(spec,),
        fetcher=lambda *_: raw,
        now=lambda: NOW,
    )
    first = seeded.refresh_if_needed()["EGM96"]
    first.coefficient_path.unlink()

    downloads: list[object] = []
    warm = GravityModelRegistry(
        tmp_path,
        active_model="EGM96",
        specs=(spec,),
        fetcher=lambda *_: downloads.append(object()) or b"must not be fetched",
        now=lambda: NOW,
    )

    record = warm.refresh_if_needed()["EGM96"]

    assert downloads == []
    assert record.status == "ok"
    assert record.available is True
    assert record.inspection is not None
    assert record.coefficient_path.read_bytes() == _coefficients()


@pytest.mark.parametrize(
    "corrupt_archive",
    (
        b"not-a-zip",
        _archive(_coefficients(), member="almost-egm96.txt"),
    ),
    ids=("invalid-zip", "wrong-member"),
)
def test_invalid_cached_archive_is_rejected_then_replaced_only_by_a_valid_download(
    tmp_path: Path,
    corrupt_archive: bytes,
):
    """A cached archive never bypasses ZIP/member validation on a warm boot."""

    spec = _small_egm96_spec()
    archive_path = tmp_path / "egm96" / spec.archive_filename
    archive_path.parent.mkdir(parents=True)
    archive_path.write_bytes(corrupt_archive)
    valid_archive = _archive(_coefficients())
    downloads: list[object] = []
    registry = GravityModelRegistry(
        tmp_path,
        active_model="EGM96",
        specs=(spec,),
        fetcher=lambda *_: downloads.append(object()) or valid_archive,
        now=lambda: NOW,
    )

    record = registry.refresh_if_needed()["EGM96"]

    assert len(downloads) == 1
    assert record.status == "ok"
    assert record.available is True
    # The corrupt user cache was never materialised.  It is atomically
    # replaced only after the newly staged archive has passed validation.
    assert archive_path.read_bytes() == valid_archive
    assert record.coefficient_path.read_bytes() == _coefficients()


def test_registry_exposes_live_download_bytes_then_validation_completion(tmp_path: Path):
    raw = _archive(_coefficients())
    started = threading.Event()
    release = threading.Event()

    def fetcher(*_args):
        started.set()
        assert release.wait(timeout=2)
        return raw

    registry = GravityModelRegistry(
        tmp_path,
        active_model="EGM96",
        specs=(_small_egm96_spec(),),
        fetcher=fetcher,
        now=lambda: NOW,
    )
    initial = registry.diagnostics_payload()["progress"]
    assert initial["state"] == "pending"
    assert initial["models"]["EGM96"]["stage"] == "waiting"

    worker = threading.Thread(target=registry.refresh_if_needed)
    worker.start()
    assert started.wait(timeout=2)
    in_flight = registry.diagnostics_payload()["progress"]
    assert in_flight["state"] == "downloading"
    assert in_flight["currentModel"] == "EGM96"
    active = in_flight["models"]["EGM96"]
    assert active["state"] == "downloading"
    assert active["stage"] == "download"
    assert active["bytesDownloaded"] == 0
    assert active["totalBytes"] is None
    assert active["percent"] is None

    release.set()
    worker.join(timeout=5)
    assert not worker.is_alive()
    completed = registry.diagnostics_payload()["progress"]
    model = completed["models"]["EGM96"]
    assert completed["state"] == "ready"
    assert completed["completedModels"] == completed["totalModels"] == 1
    assert completed["percent"] == 100
    assert model["state"] == "ready"
    assert model["stage"] == "complete"
    assert model["bytesDownloaded"] == model["totalBytes"] == len(raw)
    assert model["percent"] == 100


def test_streaming_nga_download_reports_exact_bytes_when_content_length_is_known(tmp_path: Path, monkeypatch):
    class Response:
        headers = {"Content-Length": "7"}

        def __init__(self):
            self._chunks = iter((b"abc", b"defg", b""))

        def geturl(self):
            return EGM96_SPEC.url

        def read(self, _size):
            return next(self._chunks)

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

    class Opener:
        def open(self, _request, *, timeout):
            assert timeout == 1.0
            return Response()

    monkeypatch.setattr(gravity_registry_module, "build_opener", lambda *_args: Opener())
    destination = tmp_path / "EGM96.zip"
    events: list[tuple[int, int | None]] = []

    GravityModelRegistry._download_https_to_path(
        EGM96_SPEC.url,
        1.0,
        100,
        destination,
        on_progress=lambda downloaded, total: events.append((downloaded, total)),
    )

    assert destination.read_bytes() == b"abcdefg"
    assert events == [(0, 7), (3, 7), (7, 7)]


def test_streaming_nga_download_treats_mismatched_content_length_as_observability(tmp_path: Path, monkeypatch, caplog):
    """A proxy/header discrepancy cannot reject an otherwise validated archive."""

    class Response:
        headers = {"Content-Length": "99"}

        def __init__(self):
            self._chunks = iter((b"abc", b"defg", b""))

        def geturl(self):
            return EGM96_SPEC.url

        def read(self, _size):
            return next(self._chunks)

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

    class Opener:
        def open(self, _request, *, timeout):
            assert timeout == 1.0
            return Response()

    monkeypatch.setattr(gravity_registry_module, "build_opener", lambda *_args: Opener())
    destination = tmp_path / "EGM96.zip"
    events: list[tuple[int, int | None]] = []

    GravityModelRegistry._download_https_to_path(
        EGM96_SPEC.url,
        1.0,
        100,
        destination,
        on_progress=lambda downloaded, total: events.append((downloaded, total)),
    )

    assert destination.read_bytes() == b"abcdefg"
    # Content-Length initially permits a live percentage, but a mismatch is
    # reset to indeterminate rather than claimed as a corrupted ZIP.
    assert events == [(0, 99), (3, 99), (7, 99), (7, None)]
    assert "Content-Length mismatch" in caplog.text


def test_streaming_nga_download_handles_chunked_transfer_as_indeterminate(tmp_path: Path, monkeypatch, caplog):
    class Response:
        headers = {"Content-Length": "7", "Transfer-Encoding": "chunked"}

        def __init__(self):
            self._chunks = iter((b"abc", b"defg", b""))

        def geturl(self):
            return EGM96_SPEC.url

        def read(self, _size):
            return next(self._chunks)

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

    class Opener:
        def open(self, _request, *, timeout):
            return Response()

    monkeypatch.setattr(gravity_registry_module, "build_opener", lambda *_args: Opener())
    destination = tmp_path / "EGM96.zip"
    events: list[tuple[int, int | None]] = []

    GravityModelRegistry._download_https_to_path(
        EGM96_SPEC.url,
        1.0,
        100,
        destination,
        on_progress=lambda downloaded, total: events.append((downloaded, total)),
    )

    assert destination.read_bytes() == b"abcdefg"
    assert events == [(0, None), (3, None), (7, None)]
    assert "Transfer-Encoding" in caplog.text


def test_streaming_nga_download_rejects_an_unsolicited_partial_response(tmp_path: Path, monkeypatch):
    class Response:
        headers = {"Content-Range": "bytes 0-6/7"}
        status = 206

        def geturl(self):
            return EGM96_SPEC.url

        def read(self, _size):
            return b"abcdefg"

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

    class Opener:
        def open(self, _request, *, timeout):
            return Response()

    monkeypatch.setattr(gravity_registry_module, "build_opener", lambda *_args: Opener())

    with pytest.raises(GravityModelCacheError, match="respuesta parcial"):
        GravityModelRegistry._download_https_to_path(
            EGM96_SPEC.url,
            1.0,
            100,
            tmp_path / "EGM96.zip",
        )


def test_streaming_nga_download_decodes_gzip_content_encoding_with_wire_progress(tmp_path: Path, monkeypatch):
    payload = b"abcdefg"
    encoded = gzip.compress(payload)

    class Response:
        headers = {"Content-Length": str(len(encoded)), "Content-Encoding": "gzip"}

        def __init__(self):
            self._chunks = iter((encoded[:5], encoded[5:], b""))

        def geturl(self):
            return EGM96_SPEC.url

        def read(self, _size):
            return next(self._chunks)

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

    class Opener:
        def open(self, _request, *, timeout):
            return Response()

    monkeypatch.setattr(gravity_registry_module, "build_opener", lambda *_args: Opener())
    destination = tmp_path / "EGM96.zip"
    events: list[tuple[int, int | None]] = []

    GravityModelRegistry._download_https_to_path(
        EGM96_SPEC.url,
        1.0,
        100,
        destination,
        on_progress=lambda downloaded, total: events.append((downloaded, total)),
    )

    assert destination.read_bytes() == payload
    assert events[0] == (0, len(encoded))
    assert events[-1] == (len(encoded), len(encoded))


def test_streaming_nga_download_rejects_a_truncated_gzip_body(tmp_path: Path, monkeypatch):
    encoded = gzip.compress(b"abcdefg")[:-8]

    class Response:
        headers = {"Content-Encoding": "gzip"}

        def __init__(self):
            self._chunks = iter((encoded, b""))

        def geturl(self):
            return EGM96_SPEC.url

        def read(self, _size):
            return next(self._chunks)

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

    class Opener:
        def open(self, _request, *, timeout):
            return Response()

    monkeypatch.setattr(gravity_registry_module, "build_opener", lambda *_args: Opener())

    with pytest.raises(GravityModelCacheError, match="truncada|no es válida"):
        GravityModelRegistry._download_https_to_path(
            EGM96_SPEC.url,
            1.0,
            100,
            tmp_path / "EGM96.zip",
        )


def test_nga_redirect_handler_allows_only_bounded_same_origin_https_targets():
    handler = gravity_registry_module._TrustedNgaRedirects()
    request = gravity_registry_module.Request(EGM96_SPEC.url)

    accepted = handler.redirect_request(
        request,
        None,
        302,
        "Found",
        {},
        "/downloads/EGM96_Spherical_Harmonics.zip",
    )

    assert accepted is not None
    assert accepted.full_url == "https://earth-info.nga.mil/downloads/EGM96_Spherical_Harmonics.zip"
    with pytest.raises(OSError, match="host oficial"):
        handler.redirect_request(request, None, 302, "Found", {}, "https://example.invalid/EGM96.zip")


def test_unreliable_content_length_never_accepts_a_truncated_archive(tmp_path: Path, monkeypatch):
    """A size mismatch is advisory, but ZIP/member validation still fails closed."""

    raw = _archive(_coefficients())

    class Response:
        headers = {"Content-Length": str(len(raw) + 100)}

        def __init__(self):
            self._chunks = iter((raw[:-12], b""))

        def geturl(self):
            return EGM96_SPEC.url

        def read(self, _size):
            return next(self._chunks)

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

    class Opener:
        def open(self, _request, *, timeout):
            return Response()

    monkeypatch.setattr(gravity_registry_module, "build_opener", lambda *_args: Opener())
    registry = GravityModelRegistry(
        tmp_path,
        active_model="EGM96",
        specs=(_small_egm96_spec(),),
        now=lambda: NOW,
    )

    record = registry.refresh_if_needed()["EGM96"]

    assert record.status == "error"
    assert record.available is False
    assert record.archive_path.exists() is False
    assert "ZIP válido" in (record.error or "")


def test_egm2008_exact_member_and_sparse_archive_tail_are_validated_offline(tmp_path: Path):
    """EGM2008 must not be guessed as ICGEM or as an arbitrary ZIP member."""

    spec = _small_egm2008_spec()
    raw = _archive(_egm2008_coefficients(), member="EGM2008_to2190_TideFree")
    registry = GravityModelRegistry(
        tmp_path,
        active_model="EGM2008",
        specs=(spec,),
        fetcher=lambda *_: raw,
        now=lambda: NOW,
    )

    record = registry.refresh_if_needed()["EGM2008"]
    assert record.available is True
    assert record.inspection is not None
    assert record.inspection.record_count == 11
    assert record.inspection.max_degree == 4
    assert record.spec.tide_system == "tide_free"
    assert record.inspection.max_selectable_order(4) == 3
    payload = registry.diagnostics_payload()["models"]["EGM2008"]
    assert payload["maxDegree"] == 4
    assert payload["maxOrder"] == 3
    assert payload["degreeCoverage"][-1] == {
        "startDegree": 4,
        "endDegree": 4,
        "maxOrder": 3,
        "orderRule": "fixed",
    }
    assert payload["executionLimit"]["maxHarmonicTerms"] == 2555

    # The sparse archive tail is validated, but public materialisation only
    # exposes the complete envelope selected by the caller.
    model = registry.materialize_selection(registry.resolve_selection("EGM2008", 3, 3), max_harmonic_terms=100)
    assert model.model_id == "EGM2008"
    assert model.max_degree == 3
    assert model.coefficient(2, 0)[0] == pytest.approx(-0.484165371736e-3)

    # m=0 is a valid zonal selection, including in the documented EGM2008
    # tail. It must not be rejected as if every order were positive.
    zonal = registry.materialize_selection(
        registry.resolve_selection("EGM2008", 4, 0),
        max_harmonic_terms=100,
    )
    assert zonal.max_degree == 4
    assert zonal.coefficient(4, 0)[0] == pytest.approx(0.539965866638e-6)


def test_stale_local_archive_is_refreshed_and_a_failed_refresh_keeps_the_valid_snapshot(tmp_path: Path):
    spec = _small_egm96_spec()
    first = _archive(_coefficients())
    second = _archive(_coefficients(c22="0.143914352398E-05"))
    bootstrap = GravityModelRegistry(
        tmp_path,
        active_model="EGM96",
        specs=(spec,),
        fetcher=lambda *_: first,
        now=lambda: NOW,
    )
    bootstrap.refresh_if_needed()
    cache = tmp_path / "egm96" / spec.archive_filename
    stale = NOW - timedelta(days=31)
    os.utime(cache, (stale.timestamp(), stale.timestamp()))

    calls: list[str] = []
    refreshed = GravityModelRegistry(
        tmp_path,
        active_model="EGM96",
        specs=(spec,),
        fetcher=lambda *_: calls.append("refresh") or second,
        now=lambda: NOW,
    )
    assert refreshed.refresh_if_needed()["EGM96"].status == "ok"
    assert calls == ["refresh"]

    os.utime(cache, (stale.timestamp(), stale.timestamp()))
    fallback = GravityModelRegistry(
        tmp_path,
        active_model="EGM96",
        specs=(spec,),
        fetcher=lambda *_: (_ for _ in ()).throw(OSError("offline")),
        now=lambda: NOW,
    )
    record = fallback.refresh_if_needed()["EGM96"]
    assert record.available is True
    assert record.status == "warning"
    assert record.using_cached_fallback is True
    assert "offline" in (record.error or "")


def test_corrupted_or_wrong_archive_is_fail_closed_without_writing_a_cache(tmp_path: Path):
    registry = GravityModelRegistry(
        tmp_path,
        active_model="EGM96",
        specs=(_small_egm96_spec(),),
        fetcher=lambda *_: b"not-a-zip",
        now=lambda: NOW,
    )

    record = registry.refresh_if_needed()["EGM96"]

    assert record.status == "error"
    assert record.available is False
    assert record.archive_path.exists() is False

    wrong_member = GravityModelRegistry(
        tmp_path / "wrong-member",
        active_model="EGM96",
        specs=(_small_egm96_spec(),),
        fetcher=lambda *_: _archive(_coefficients(), member="almost-egm96.txt"),
        now=lambda: NOW,
    )
    assert wrong_member.refresh_if_needed()["EGM96"].status == "error"

    nested_member = GravityModelRegistry(
        tmp_path / "nested-member",
        active_model="EGM96",
        specs=(_small_egm96_spec(),),
        fetcher=lambda *_: _archive(_coefficients(), member="untrusted/EGM96"),
        now=lambda: NOW,
    )
    assert nested_member.refresh_if_needed()["EGM96"].status == "error"


def test_nga_header_is_a_claim_not_permission_to_invent_missing_tail_rows(tmp_path: Path):
    spec = _small_egm2008_spec()
    raw = _archive(
        b"# max_degree = 4\n# max_order = 4\n" + _egm2008_coefficients(),
        member="EGM2008_to2190_TideFree",
    )
    registry = GravityModelRegistry(
        tmp_path,
        active_model="EGM2008",
        specs=(spec,),
        fetcher=lambda *_: raw,
        now=lambda: NOW,
    )

    record = registry.refresh_if_needed()["EGM2008"]
    assert record.available is True
    assert record.inspection is not None
    assert record.inspection.header_max_degree == 4
    assert record.inspection.header_max_order == 4
    # The decompressed rows, not the header, determine this effective order.
    assert registry.resolve_selection("EGM2008", 4, 4).order == 3


@pytest.mark.parametrize(
    "prefix",
    (
        b"0 0 1 0\n0 0 1 0\n",
        b"1 0 1 0\n",
        b"1 0 0 0\n",
    ),
)
def test_nga_rejects_duplicate_or_noncanonical_degree_zero_and_one_rows(tmp_path: Path, prefix: bytes):
    registry = GravityModelRegistry(
        tmp_path,
        active_model="EGM96",
        specs=(_small_egm96_spec(),),
        fetcher=lambda *_: _archive(prefix + _coefficients()),
        now=lambda: NOW,
    )

    record = registry.refresh_if_needed()["EGM96"]
    assert record.available is False
    assert record.status == "error"


def test_nga_accepts_only_complete_canonical_degree_one_rows_before_degree_two(tmp_path: Path):
    prefix = b"0 0 1 0\n1 0 0 0\n1 1 0 0\n"
    registry = GravityModelRegistry(
        tmp_path,
        active_model="EGM96",
        specs=(_small_egm96_spec(),),
        fetcher=lambda *_: _archive(prefix + _coefficients()),
        now=lambda: NOW,
    )

    record = registry.refresh_if_needed()["EGM96"]
    assert record.available is True
    model = registry.materialize_selection(
        registry.resolve_selection("EGM96", 3, 0),
        max_harmonic_terms=100,
    )
    assert model.coefficient(1, 0) == (0.0, 0.0)


def test_refresh_streams_a_fixture_larger_than_the_compatibility_bytes_adapter(tmp_path: Path):
    # The production path writes the archive to staging then reads bounded
    # lines from ZipFile.open. This stored fixture exceeds the test-only
    # bytes-adapter ceiling but remains well within EGM96's real archive cap.
    comment = b"#" + (b"x" * 14_000) + b"\n"
    raw = _archive(
        (comment * 300) + _coefficients(),
        compression=zipfile.ZIP_STORED,
    )
    assert len(raw) > 4 * 1024 * 1024
    registry = GravityModelRegistry(
        tmp_path,
        active_model="EGM96",
        specs=(_small_egm96_spec(),),
        fetcher=lambda *_: raw,
        now=lambda: NOW,
    )

    record = registry.refresh_if_needed()["EGM96"]
    assert record.available is True
    assert record.inspection is not None
    assert record.inspection.coefficient_byte_size > 4 * 1024 * 1024


def test_selection_fails_closed_until_archive_validation_and_uses_inspected_sparse_limits(tmp_path: Path):
    calls: list[str] = []
    registry = GravityModelRegistry(
        tmp_path,
        active_model="EGM2008",
        specs=(_small_egm2008_spec(),),
        fetcher=lambda *_: calls.append("network") or _archive(
            _egm2008_coefficients(),
            member="EGM2008_to2190_TideFree",
        ),
        now=lambda: NOW,
    )

    with pytest.raises(GravityModelCacheError, match="no está disponible"):
        registry.resolve_selection("EGM2008", 4, 4)
    assert calls == []

    registry.refresh_if_needed()
    selection = registry.resolve_selection("EGM2008", 4, 4)

    # The source's degree-four tail has rows only through m=3. The selector
    # derives 4×3 from it; the hard 4×4 fixture ceiling is never advertised.
    assert (selection.degree, selection.order) == (4, 3)
    assert selection.provenance["modelMaxDegree"] == 4
    assert selection.provenance["modelMaxOrder"] == 3
    assert selection.provenance["maxSelectableOrder"] == 3
    assert any("maxDegree=4" in warning for warning in selection.warnings)
    assert EGM2008_SPEC.max_degree == 2190
    assert EGM2008_SPEC.max_order == 2190

    forged = replace(selection, order=4)
    with pytest.raises(GravityModelCacheError, match="cubierta"):
        registry.materialize_selection(forged, max_harmonic_terms=100)


def test_resolution_requires_a_valid_local_snapshot_and_never_starts_a_refresh(tmp_path: Path):
    calls: list[str] = []
    registry = GravityModelRegistry(
        tmp_path,
        active_model="EGM96",
        specs=(_small_egm96_spec(),),
        fetcher=lambda *_: calls.append("network") or _archive(_coefficients()),
        now=lambda: NOW,
    )

    with pytest.raises(GravityModelCacheError, match="no está disponible"):
        registry.resolve_selection("EGM96", 3, 3)
    assert calls == []


def test_manual_cowell_uses_the_resolved_nga_selection_and_reports_clamping(tmp_path: Path):
    registry = GravityModelRegistry(
        tmp_path,
        active_model="EGM96",
        specs=(_small_egm96_spec(),),
        fetcher=lambda *_: _archive(_coefficients()),
        now=lambda: NOW,
    )
    registry.refresh_if_needed()
    request = ManualOrbitRequest(
        name="NGA selection",
        epochUtc="2026-08-14T00:00:00Z",
        propagator="cowell-rk4",
        keplerian={
            "semiMajorAxisKm": 7000,
            "eccentricity": 0.001,
            "inclinationDeg": 45,
            "raanDeg": 0,
            "argumentOfPeriapsisDeg": 0,
            "trueAnomalyDeg": 0,
        },
        propagationOptions={
            "forceTerms": ["geopotential"],
            # ``gravityModel`` remains accepted only when it is an unambiguous
            # EGM source rather than one of the legacy force presets.
            "gravityModel": "EGM96",
            "geopotentialDegree": 400,
            "geopotentialOrder": 400,
        },
    )
    _source, keplerian, state = canonical_manual_orbit(request)
    _runtime_id, propagator, metadata = build_manual_orbit_propagator(
        request.propagator,
        name=request.name,
        epoch=request.epoch,
        keplerian=keplerian,
        state_vector=state,
        propagation_options=request.propagation_options.canonical(propagator="cowell-rk4"),
        gravity_model_registry=registry,
    )

    assert propagator.geopotential_model is not None
    assert propagator.geopotential_model.model_id == "EGM96"
    assert propagator.geopotential_configuration is not None
    assert (propagator.geopotential_configuration.degree, propagator.geopotential_configuration.order) == (3, 3)
    selection = metadata["geopotential"]["selection"]
    assert selection["model"] == "EGM96"
    assert (selection["degree"], selection["order"]) == (3, 3)
    assert selection["warnings"]


def test_manual_cowell_accepts_egm2008_zonal_order_zero(tmp_path: Path):
    registry = GravityModelRegistry(
        tmp_path,
        active_model="EGM2008",
        specs=(_small_egm2008_spec(),),
        fetcher=lambda *_: _archive(
            _egm2008_coefficients(),
            member="EGM2008_to2190_TideFree",
        ),
        now=lambda: NOW,
    )
    registry.refresh_if_needed()
    request = ManualOrbitRequest(
        name="EGM2008 zonal",
        epochUtc="2026-08-14T00:00:00Z",
        propagator="cowell-rk4",
        keplerian={
            "semiMajorAxisKm": 7000,
            "eccentricity": 0.001,
            "inclinationDeg": 45,
            "raanDeg": 0,
            "argumentOfPeriapsisDeg": 0,
            "trueAnomalyDeg": 0,
        },
        propagationOptions={
            "forceTerms": ["geopotential"],
            "geopotentialModel": "EGM2008",
            "geopotentialDegree": 4,
            "geopotentialOrder": 0,
        },
    )
    _source, keplerian, state = canonical_manual_orbit(request)
    _runtime_id, propagator, metadata = build_manual_orbit_propagator(
        request.propagator,
        name=request.name,
        epoch=request.epoch,
        keplerian=keplerian,
        state_vector=state,
        propagation_options=request.propagation_options.canonical(propagator="cowell-rk4"),
        gravity_model_registry=registry,
    )

    assert propagator.geopotential_configuration is not None
    assert (propagator.geopotential_configuration.degree, propagator.geopotential_configuration.order) == (4, 0)
    assert metadata["geopotential"]["selection"]["harmonicTerms"] == 4


def test_materialisation_reuses_an_immutable_selection_and_rate_limits_new_scans(tmp_path: Path):
    registry = GravityModelRegistry(
        tmp_path,
        active_model="EGM96",
        specs=(_small_egm96_spec(),),
        fetcher=lambda *_: _archive(_coefficients()),
        now=lambda: NOW,
    )
    registry.refresh_if_needed()
    first_selection = registry.resolve_selection("EGM96", 3, 3)
    first = registry.materialize_selection(first_selection, max_harmonic_terms=100)
    assert registry.materialize_selection(first_selection, max_harmonic_terms=100) is first
    assert registry.diagnostics_payload()["materialization"]["recentMisses"] == 1

    for degree, order in ((3, 0), (2, 0), (2, 1)):
        registry.materialize_selection(
            registry.resolve_selection("EGM96", degree, order),
            max_harmonic_terms=100,
        )
    assert registry.diagnostics_payload()["materialization"]["cachedSelections"] == 4
    with pytest.raises(GravityModelCacheError, match="demasiadas materializaciones"):
        registry.materialize_selection(
            registry.resolve_selection("EGM96", 3, 1),
            max_harmonic_terms=100,
        )
