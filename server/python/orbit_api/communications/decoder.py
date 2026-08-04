"""Validation and decoding of client-originated realtime messages."""

import json

from .types import SubscriptionCommand


_SUPPORTED_OPERATIONS = {"subscribe", "unsubscribe", "set_subscriptions"}


def decode_subscription_command(raw_message: str | bytes | None) -> SubscriptionCommand | None:
    """Decode a supported subscription command or ignore invalid client input."""
    if not raw_message:
        return None
    try:
        payload = json.loads(raw_message)
    except (TypeError, ValueError, UnicodeDecodeError):
        return None
    if not isinstance(payload, dict):
        return None

    operation = payload.get("type")
    if operation not in _SUPPORTED_OPERATIONS:
        return None
    raw_ids = payload.get("ids")
    satellite_ids = tuple(str(value) for value in raw_ids if isinstance(value, str)) if isinstance(raw_ids, list) else ()
    return SubscriptionCommand(operation=operation, satellite_ids=satellite_ids)
