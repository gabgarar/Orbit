"""Centralised runtime limits and filesystem locations for the API."""

from pathlib import Path


BASE_DIR = Path(__file__).resolve().parents[4]
CONFIG_DIR = BASE_DIR / "config"
SYSTEM_CONFIG_PATH = CONFIG_DIR / "system_config.json"

MAX_CACHED_ORBITS = 50
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
