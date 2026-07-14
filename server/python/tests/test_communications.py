import asyncio

from orbit_api.communications.decoder import decode_subscription_command
from orbit_api.communications.encoding import send_payload
from orbit_api.communications.subscriptions import SubscriptionState


def test_subscription_command_updates_state():
    command = decode_subscription_command('{"type":"set_subscriptions","ids":["ISS","HUBBLE"]}')
    assert command is not None
    state = SubscriptionState()
    state.apply(command)
    assert state.satellite_ids == {"ISS", "HUBBLE"}
    assert state.consume_refresh_request() is True
    assert state.consume_refresh_request() is False


def test_invalid_realtime_message_is_ignored():
    assert decode_subscription_command('{"type":"invalid"}') is None


def test_encoder_uses_text_for_small_realtime_payloads():
    class FakeWebSocket:
        def __init__(self):
            self.text = None
            self.binary = None

        async def send_text(self, value):
            self.text = value

        async def send_bytes(self, value):
            self.binary = value

    websocket = FakeWebSocket()
    asyncio.run(send_payload(websocket, {"type": "state", "data": []}, compression_threshold=10_000))
    assert websocket.text is not None
    assert websocket.binary is None
