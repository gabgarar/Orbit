"""Centralised runtime limits and filesystem locations for the API."""

from pathlib import Path


BASE_DIR = Path(__file__).resolve().parents[4]
CONFIG_DIR = BASE_DIR / "config"
DATA_DIR = BASE_DIR / "data"
# Downloaded public IERS C01 data is mutable operational cache, not project
# configuration and not an image build input. Compose mounts ``./data`` at
# runtime so a validated cache survives a container rebuild/restart.
ERP_DATA_DIR = DATA_DIR / "erp"
IERS_EOP_C01_CACHE_PATH = ERP_DATA_DIR / "EOP_C01_IAU2000_1846-now.txt"
SYSTEM_CONFIG_PATH = CONFIG_DIR / "system_config.json"
# Local precise products are content-addressed source files plus a small
# manifest.  ``config`` is mounted into the container, so imports survive a
# Docker rebuild/restart without being copied into the application image.
PRECISE_PRODUCTS_DIR = CONFIG_DIR / "precise-products"
# Per-manual-orbit ERP uploads are kept separately from SP3 product bundles.
# The project document stores only the content-addressed snapshot ID, while
# these local bytes remain in the mounted config volume for reproducible
# restore and force evaluation.
MANUAL_ERP_SNAPSHOTS_DIR = CONFIG_DIR / "manual-erp-snapshots"

AUTO_MIN_ORBIT_SAMPLES = 24
# Enough for a 12-hour low-Earth path at the angular tessellation used by the
# renderer.  The shared batch budget in sampling.py still protects large layer
# sets from allocating this number for every object.
AUTO_MAX_ORBIT_SAMPLES = 7200
PROPAGATION_HOURS_MIN = 0.1
PROPAGATION_HOURS_MAX = 24.0 * 365.0
ORBIT_CACHE_TTL_SECONDS = 10
MAX_TOTAL_ORBIT_POINTS_PER_BATCH = 300_000
COMPRESSION_THRESHOLD = 1024
MAX_EPHEMERIS_CACHE_ITEMS = 256
EPHEMERIS_CACHE_TTL_SECONDS = 120
MAX_EPHEMERIS_POINTS = 20_000
