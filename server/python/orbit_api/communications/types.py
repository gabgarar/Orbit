"""Typed protocol objects exchanged through the realtime WebSocket."""

from dataclasses import dataclass
from typing import Literal


SubscriptionOperation = Literal["subscribe", "unsubscribe", "set_subscriptions"]


@dataclass(frozen=True)
class SubscriptionCommand:
    """A validated client request to alter its satellite subscriptions."""

    operation: SubscriptionOperation
    satellite_ids: tuple[str, ...]
