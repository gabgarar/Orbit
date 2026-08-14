"""Shared execution limits for the current pure-Python force evaluator."""

# All locally supplied or NGA-derived field headers must stay inside this
# parser/request envelope. It is checked before any O(N²) completeness work.
MAX_SUPPORTED_GRAVITY_FIELD_DEGREE = 2_190

# Every configured harmonic is evaluated at every fixed RK4 stage. This is an
# execution guard only: archive-derived scientific limits are reported by the
# gravity registry and may be larger than this interactive implementation can
# safely materialise.
MAX_PURE_PYTHON_RK4_GEOPOTENTIAL_TERMS = 2_555  # sum(n + 1, n=1..70)

# A checksum-pinned local ICGEM file is parsed into one immutable complete
# triangular field at process start.  Unlike the NGA registry, it has no
# requested N×M yet and therefore cannot selectively materialise a small
# subset of a mission-scale file.  Keep the complete model within exactly the
# same dense 70×70 profile that the pure-Python RK4 can evaluate: C00 plus the
# 2,555 non-central harmonics.
MAX_LOCAL_ICGEM_MATERIALIZED_COEFFICIENTS = (
    MAX_PURE_PYTHON_RK4_GEOPOTENTIAL_TERMS + 1
)

# This deliberately generous cap is a second, independent guard at the local
# file boundary.  A complete degree-70 ICGEM field is normally well below it;
# the cap prevents a substituted or mission-scale .gfc file from being read,
# decoded, hashed and retained in memory during startup.
MAX_LOCAL_ICGEM_FILE_BYTES = 16 * 1024 * 1024
