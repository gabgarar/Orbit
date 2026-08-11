"""Format-neutral metadata readers for imported orbital ephemerides.

These readers preserve native frame and time-scale declarations.  They are an
ingestion boundary only; propagation and frame transformations remain separate
services.
"""

from orbit_api.timekeeping import TimeScale

from .clk import (
    ClockSample,
    RinexClockMetadata,
    RinexClockProduct,
    parse_rinex_clock_metadata,
    parse_rinex_clock_product,
)
from .metadata import (
    EphemerisFormatError,
    OemMetadata,
    OemSegmentMetadata,
    ReferenceFrame,
    Sp3Metadata,
    parse_reference_frame,
)
from .oem import (
    OemCovarianceRecord,
    OemStateProvider,
    parse_oem_metadata,
    parse_oem_state_provider,
)
from .sp3 import (
    Sp3StateProvider,
    Sp3ValidationReport,
    parse_sp3_metadata,
    parse_sp3_state_provider,
)
from .tabular import TabularStateProvider

__all__ = [
    "ClockSample",
    "EphemerisFormatError",
    "OemCovarianceRecord",
    "OemMetadata",
    "OemSegmentMetadata",
    "OemStateProvider",
    "ReferenceFrame",
    "RinexClockMetadata",
    "RinexClockProduct",
    "Sp3Metadata",
    "Sp3StateProvider",
    "Sp3ValidationReport",
    "TabularStateProvider",
    "TimeScale",
    "parse_oem_metadata",
    "parse_oem_state_provider",
    "parse_reference_frame",
    "parse_rinex_clock_metadata",
    "parse_rinex_clock_product",
    "parse_sp3_metadata",
    "parse_sp3_state_provider",
]
