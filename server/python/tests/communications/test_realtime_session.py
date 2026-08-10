"""Realtime state building must use the runtime StateVector callback."""

from orbit_api.communications.realtime_session import RealtimeSession


def test_runtime_callback_is_used_instead_of_legacy_six_component_propagation():
    calls: list[tuple[dict, tuple[str, ...]]] = []

    def build_state(by_name, satellite_ids):
        calls.append((by_name, tuple(satellite_ids)))
        return [{"satellite": "precise:product:G01", "availability": "unavailable"}]

    session = RealtimeSession(
        object(),
        lambda: ([], {}, {}),
        lambda *_: [],
        100,
        build_state,
    )
    session._subscriptions.satellite_ids = {"precise:product:G01"}
    sources = {"precise:product:G01": object()}

    payload = session._build_state(sources)

    assert payload == [{"satellite": "precise:product:G01", "availability": "unavailable"}]
    assert calls == [(sources, ("precise:product:G01",))]
