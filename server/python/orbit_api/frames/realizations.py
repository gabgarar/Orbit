"""Published terrestrial-realization operations.

This module intentionally contains only operations whose datum parameters are
published by their owning geodetic service.  It does *not* turn a matching
frame name into a transform automatically: callers must register every
operation they elect to use.
"""

from __future__ import annotations

from dataclasses import replace
from typing import Callable

from .model import FrameId, StateVector
from .transforms import FrameTransformService


# IGSMAIL-8238 is the primary IGS publication for the IGS20 adoption.  It
# explicitly states that IGS20 and ITRF2020 have the same origin, scale and
# orientation, and consequently zero transformation parameters.  The URL is
# retained in each transformed state so exports/audits can reproduce the
# decision without a network call at transform time.
IGS20_ITRF2020_SOURCE = "IGSMAIL-8238"
IGS20_ITRF2020_SOURCE_URL = "https://lists.igs.org/pipermail/igsmail/2022/008234.html"
IGS20_ITRF2020_OPERATION = "IGS20-ITRF2020-published-zero-datum-parameters"


def register_igs20_itrf2020_identity(transformer: FrameTransformService) -> None:
    """Register the published, opt-in IGS20 <-> ITRF2020 datum identity.

    IGS publishes all global datum parameters between IGS20 and ITRF2020 as
    zero.  This operation is therefore appropriate for Earth-centred satellite
    orbit states whose source is declared as IGS20.  It is deliberately not a
    station-coordinate conversion: IGS also publishes antenna-calibration
    offsets for individual reference stations, and those site/antenna/time
    dependent corrections cannot be represented by this global identity.

    Nothing calls this helper automatically.  A deployment must deliberately
    choose it (for example, after pinning its display realization to ITRF2020)
    and can inspect the state provenance that this operation adds.
    """

    directions = (("IGS20", "ITRF2020"), ("ITRF2020", "IGS20"))
    if any(transformer.has_terrestrial_realization_transform(*direction) for direction in directions):
        raise ValueError(
            "The IGS20 <-> ITRF2020 published identity cannot replace an existing "
            "terrestrial-realization operation"
        )

    transformer.register_terrestrial_realization_transform(
        "IGS20",
        "ITRF2020",
        _published_zero_datum_transform(
            source_label="IGS20",
            target_frame=FrameId.ITRF,
            target_realization="ITRF2020",
            direction="IGS20_to_ITRF2020",
        ),
    )
    transformer.register_terrestrial_realization_transform(
        "ITRF2020",
        "IGS20",
        _published_zero_datum_transform(
            source_label="ITRF2020",
            target_frame="IGS",
            target_realization="IGS20",
            direction="ITRF2020_to_IGS20",
        ),
    )


def _published_zero_datum_transform(
    *,
    source_label: str,
    target_frame: FrameId | str,
    target_realization: str,
    direction: str,
) -> Callable[[StateVector], StateVector]:
    """Build a callback that preserves geometry and records its authority."""

    def transform(state: StateVector) -> StateVector:
        provenance = dict(state.provenance)
        provenance["terrestrial_realization_transform"] = {
            "operation": IGS20_ITRF2020_OPERATION,
            "direction": direction,
            "source_realization": source_label,
            "target_realization": target_realization,
            "method": "published zero terrestrial-datum parameters",
            "authority": IGS20_ITRF2020_SOURCE,
            "source_url": IGS20_ITRF2020_SOURCE_URL,
            "parameters": {
                "translation_mm": (0.0, 0.0, 0.0),
                "scale_ppb": 0.0,
                "rotation_mas": (0.0, 0.0, 0.0),
                "translation_rate_mm_per_year": (0.0, 0.0, 0.0),
                "scale_rate_ppb_per_year": 0.0,
                "rotation_rate_mas_per_year": (0.0, 0.0, 0.0),
            },
            "scope": "Earth-centred satellite-orbit datum alignment",
            "station_coordinate_corrections_applied": False,
            "station_coordinate_limitation": (
                "Individual IGS20 station antenna-calibration offsets are not part "
                "of this global datum operation"
            ),
            "orbit_product_limitation": (
                "Satellite antenna phase-centre and other source-product conventions "
                "are not altered by this datum operation"
            ),
        }
        return replace(
            state,
            frame=target_frame,
            frame_realization=target_realization,
            provenance=provenance,
            transform_path=(*state.transform_path, source_label, target_realization),
        )

    return transform
