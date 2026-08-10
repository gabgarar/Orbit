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

# IGS's 2025 frame update publishes the zero-parameter relationship for the
# operational IGS20 family.  The three labels are kept as distinct operations
# in provenance; an IGc20 product must never be silently relabelled as IGS20.
IGS20_FAMILY_ITRF2020_SOURCE = "IGS20-family frame update (2025-11-17)"
IGS20_FAMILY_ITRF2020_SOURCE_URL = (
    "https://lists.igs.org/pipermail/igsmail/attachments/20251117/"
    "affd0c37/attachment-0001.htm"
)
IGS20_FAMILY_ITRF2020_OPERATION = "IGS20-family-ITRF2020-published-zero-datum-parameters"


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


def register_igs20_family_itrf2020_identities(transformer: FrameTransformService) -> None:
    """Register the explicit IGS20/IGb20/IGc20 zero-datum family operations.

    The helper is intentionally separate from
    :func:`register_igs20_itrf2020_identity`: deployments that enabled the
    historical exact IGS20 flag retain exactly that behaviour.  Enabling this
    wider helper is an operator decision for current IGS Final/MGEX/ESA
    products whose SP3 headers can declare ``IGb20`` or ``IGc20``.

    It applies only to Earth-centred satellite orbit states and records the
    individual source realization in every output.  It is not a station or
    antenna coordinate transformation.
    """

    labels = ("IGS20", "IGB20", "IGC20")
    directions = tuple(
        direction
        for label in labels
        for direction in ((label, "ITRF2020"), ("ITRF2020", label))
    )
    if any(transformer.has_terrestrial_realization_transform(*direction) for direction in directions):
        raise ValueError(
            "The IGS20-family <-> ITRF2020 published identities cannot replace an existing "
            "terrestrial-realization operation"
        )
    for label in labels:
        transformer.register_terrestrial_realization_transform(
            label,
            "ITRF2020",
            _published_zero_datum_transform(
                source_label=label,
                target_frame=FrameId.ITRF,
                target_realization="ITRF2020",
                direction=f"{label}_to_ITRF2020",
                operation=IGS20_FAMILY_ITRF2020_OPERATION,
                authority=IGS20_FAMILY_ITRF2020_SOURCE,
                source_url=IGS20_FAMILY_ITRF2020_SOURCE_URL,
            ),
        )
        transformer.register_terrestrial_realization_transform(
            "ITRF2020",
            label,
            _published_zero_datum_transform(
                source_label="ITRF2020",
                target_frame="IGS",
                target_realization=label,
                direction=f"ITRF2020_to_{label}",
                operation=IGS20_FAMILY_ITRF2020_OPERATION,
                authority=IGS20_FAMILY_ITRF2020_SOURCE,
                source_url=IGS20_FAMILY_ITRF2020_SOURCE_URL,
            ),
        )
def _published_zero_datum_transform(
    *,
    source_label: str,
    target_frame: FrameId | str,
    target_realization: str,
    direction: str,
    operation: str = IGS20_ITRF2020_OPERATION,
    authority: str = IGS20_ITRF2020_SOURCE,
    source_url: str = IGS20_ITRF2020_SOURCE_URL,
) -> Callable[[StateVector], StateVector]:
    """Build a callback that preserves geometry and records its authority."""

    def transform(state: StateVector) -> StateVector:
        provenance = dict(state.provenance)
        provenance["terrestrial_realization_transform"] = {
            "operation": operation,
            "direction": direction,
            "source_realization": source_label,
            "target_realization": target_realization,
            "method": "published zero terrestrial-datum parameters",
            "authority": authority,
            "source_url": source_url,
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
