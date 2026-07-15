"""ASGI entry point for Orbit.

All application composition lives in :mod:`orbit_api.bootstrap`; this module is
kept intentionally small so Uvicorn and deployment tooling have one stable target.
"""

import uvicorn

from orbit_api.bootstrap import create_app


app = create_app()


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8765, log_level="info")
