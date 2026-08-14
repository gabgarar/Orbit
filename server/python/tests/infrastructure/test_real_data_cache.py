"""Offline unit contracts for the opt-in real-data cache/downloader."""

from __future__ import annotations

import gzip
import hashlib
import json
from pathlib import Path

import pytest
from tests_support.real_data import (
    REAL_DATA_CAPABILITIES,
    DatasetSpec,
    RealDataCache,
    RealDataDownloadError,
    RealDataUnavailable,
    RealDataValidationError,
)


class _FakeResponse:
    def __init__(
        self,
        body: bytes,
        *,
        url: str,
        status: int = 200,
        content_length: str | None = None,
    ) -> None:
        self._body = body
        self._offset = 0
        self._url = url
        self.status = status
        self.headers = {} if content_length is None else {"Content-Length": content_length}

    def read(self, amount: int = -1) -> bytes:
        if amount < 0:
            amount = len(self._body) - self._offset
        block = self._body[self._offset:self._offset + amount]
        self._offset += len(block)
        return block

    def geturl(self) -> str:
        return self._url

    def getcode(self) -> int:
        return self.status

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False


class _FakeOpener:
    def __init__(self, responses: list[_FakeResponse]) -> None:
        self.responses = responses
        self.requests = []

    def open(self, request, timeout: float):
        self.requests.append((request, timeout))
        return self.responses.pop(0)


def _sp3_bytes() -> bytes:
    text = """#cP2025 05 11 00 00 00.00000000       2 ORBIT ITRF  FIT COD
## 0000 0 60.00000000 0 0
+    1   G01
%c cc UTC ccc ccc ccc ccc ccc ccc ccc ccc ccc ccc ccc ccc
*  2025 05 11 00 00 00.00000000
PG01   7000.000000    100.000000     10.000000      0.123456
*  2025 05 11 00 01 00.00000000
PG01   7060.000000    101.000000     11.000000      0.123456"""
    return gzip.compress(text.encode("ascii"), mtime=0)


def _spec(payload: bytes, *, expected_sha256: str | None = None) -> DatasetSpec:
    return DatasetSpec(
        identifier="fixture-sp3",
        filename="fixture.SP3.gz",
        url="https://example.test/fixed/fixture.SP3.gz",
        allowed_host="example.test",
        content_kind="sp3-gzip",
        min_bytes=1,
        max_bytes=1024 * 1024,
        max_expanded_bytes=1024 * 1024,
        expected_sha256=expected_sha256 or hashlib.sha256(payload).hexdigest(),
    )


def test_download_validates_pinned_bytes_writes_sidecar_and_reuses_cache_without_network(tmp_path: Path):
    payload = _sp3_bytes()
    spec = _spec(payload)
    opener = _FakeOpener([
        _FakeResponse(payload, url=spec.url, content_length=str(len(payload))),
    ])
    cache = RealDataCache(tmp_path / "cache", opener=opener)

    downloaded = cache.ensure(spec, download=True)
    reused = cache.ensure(spec, download=False)

    assert downloaded.origin == "download"
    assert downloaded.sha256 == spec.expected_sha256
    assert downloaded.content_length_matches is True
    assert reused.origin == "cache"
    assert len(opener.requests) == 1
    metadata = json.loads(cache.metadata_path(spec).read_text(encoding="utf-8"))
    assert metadata["sha256"] == spec.expected_sha256
    assert metadata["bytes"] == len(payload)
    assert metadata["url"] == spec.url


def test_mismatched_content_length_is_observed_but_pinned_complete_data_is_not_rejected(tmp_path: Path):
    payload = _sp3_bytes()
    spec = _spec(payload)
    opener = _FakeOpener([
        _FakeResponse(payload, url=spec.url, content_length=str(len(payload) + 17)),
    ])

    actual = RealDataCache(tmp_path / "cache", opener=opener).ensure(spec, download=True)

    assert actual.content_length == len(payload) + 17
    assert actual.content_length_matches is False
    assert actual.sha256 == spec.expected_sha256


def test_wrong_digest_never_becomes_a_cache_entry(tmp_path: Path):
    expected = _sp3_bytes()
    received = _sp3_bytes() + b"unexpected"
    spec = _spec(expected)
    opener = _FakeOpener([_FakeResponse(received, url=spec.url)])
    cache = RealDataCache(tmp_path / "cache", opener=opener)

    with pytest.raises(RealDataValidationError, match="SHA-256 inesperado"):
        cache.ensure(spec, download=True)

    assert not cache.cache_path(spec).exists()
    assert not cache.metadata_path(spec).exists()


def test_tampered_cached_bytes_are_not_trusted_from_their_sidecar(tmp_path: Path):
    payload = _sp3_bytes()
    spec = _spec(payload)
    opener = _FakeOpener([_FakeResponse(payload, url=spec.url)])
    cache = RealDataCache(tmp_path / "cache", opener=opener)
    cache.ensure(spec, download=True)
    cache.cache_path(spec).write_bytes(b"corrupt")

    assert cache.validate_cached(spec) is None
    with pytest.raises(RealDataUnavailable, match="No hay una copia válida"):
        cache.ensure(spec, download=False)


def test_changed_final_url_is_rejected_before_any_cache_write(tmp_path: Path):
    payload = _sp3_bytes()
    spec = _spec(payload)
    opener = _FakeOpener([_FakeResponse(payload, url="https://elsewhere.invalid/fixture.SP3.gz")])
    cache = RealDataCache(tmp_path / "cache", opener=opener)

    with pytest.raises(RealDataDownloadError, match="cambió de URL"):
        cache.ensure(spec, download=True)

    assert not cache.cache_path(spec).exists()


def test_dataset_spec_rejects_non_https_hosts_parameters_and_unpinned_unsafe_names():
    with pytest.raises(ValueError, match="no es seguro|HTTPS"):
        DatasetSpec(
            identifier="invalid-spec",
            filename="../../escape.SP3.gz",
            url="http://example.test/file?next=bad",
            allowed_host="example.test",
            content_kind="sp3-gzip",
            min_bytes=1,
            max_bytes=2,
            max_expanded_bytes=2,
        )


def test_real_data_manifest_does_not_claim_unimplemented_high_fidelity_models():
    assert REAL_DATA_CAPABILITIES["code_mgex_sp3_erp"]["available"] is True
    for capability in ("egm2008_2190x2190", "msise_nrlmsise", "de430_spice", "stk_gmat_24h_reference"):
        item = REAL_DATA_CAPABILITIES[capability]
        assert item["available"] is False
        assert item["reason"]
