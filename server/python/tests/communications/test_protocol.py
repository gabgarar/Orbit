"""Realtime protocol decoding, state and encoding tests."""

import asyncio
import json
import zlib

from orbit_api.communications.decoder import decode_subscription_command
from orbit_api.communications.encoding import send_payload
from orbit_api.communications.subscriptions import SubscriptionState


class FakeWebSocket:
    def __init__(self): self.text = self.binary = None
    async def send_text(self, value): self.text = value
    async def send_bytes(self, value): self.binary = value


def test_decoder_and_subscription_state_cover_all_operations():
    state = SubscriptionState()
    for raw in ('{"type":"subscribe","ids":["ISS"]}', '{"type":"unsubscribe","ids":["ISS"]}', '{"type":"set_subscriptions","ids":["HUBBLE",4]}'):
        state.apply(decode_subscription_command(raw))
    assert state.satellite_ids == {"HUBBLE"} and state.consume_refresh_request()
    assert decode_subscription_command("not json") is None


def test_encoder_selects_text_or_compressed_binary_transport():
    small, large = FakeWebSocket(), FakeWebSocket()
    asyncio.run(send_payload(small, {"type": "state", "data": []}, 10_000))
    asyncio.run(send_payload(large, {"data": ["same value"] * 200}, 10))
    assert json.loads(small.text)["type"] == "state"
    assert json.loads(zlib.decompress(large.binary))["data"]
