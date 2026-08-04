"""State wrapper for a single WebSocket client's satellite subscriptions."""

from .types import SubscriptionCommand


class SubscriptionState:
    """Apply client commands and expose whether a refresh is required."""

    def __init__(self):
        self.satellite_ids: set[str] = set()
        self.refresh_requested = False

    def apply(self, command: SubscriptionCommand) -> None:
        if command.operation == "subscribe":
            self.satellite_ids.update(command.satellite_ids)
        elif command.operation == "unsubscribe":
            self.satellite_ids.difference_update(command.satellite_ids)
        else:
            self.satellite_ids = set(command.satellite_ids)
        self.refresh_requested = True

    def consume_refresh_request(self) -> bool:
        requested = self.refresh_requested
        self.refresh_requested = False
        return requested
