"""Validated request contracts shared by HTTP endpoint handlers."""

import datetime
import math
import re
from typing import Literal

from pydantic import (
    AliasChoices,
    BaseModel,
    ConfigDict,
    Field,
    field_validator,
    model_validator,
)

from orbit_api.core.settings import (
    AUTO_MAX_ORBIT_SAMPLES,
    PROPAGATION_HOURS_MAX,
    PROPAGATION_HOURS_MIN,
)
from orbit_api.timekeeping import ensure_utc

# These are the selectable *new-design* manual propagation families. A
# manual state is defined in EME2000 at an epoch, so it must be propagated by
# a native analytical or numerical engine. ``cowell-rk4`` is deliberately a
# propagation family: its numerical integrator and force model are separate
# options.
MANUAL_ORBIT_PROPAGATORS = ("two-body", "cowell-rk4")

# The request model can still deserialize these persisted IDs so saved project
# documents can be identified and handled deliberately. ``j2-j3-j4`` remains
# executable solely to reproduce its former native implementation. ``sgp4``
# is *not* executable for a manual state: it was an old synthetic-TLE shortcut
# which treated EME2000 osculating elements as NORAD mean elements.
LEGACY_MANUAL_ORBIT_PROPAGATORS = ("sgp4", "j2-j3-j4")
MANUAL_ORBIT_SGP4_UNAVAILABLE_MESSAGE = (
    "SGP4 no está disponible para órbitas manuales: requiere elementos medios "
    "NORAD/TLE y produce estados TEME. Usa two-body o cowell-rk4 para una "
    "órbita manual en EME2000. El ajuste y la exportación de un TLE sintético "
    "serán una operación separada."
)
_MANUAL_ORBIT_PROPAGATOR_ALIASES = {
    "sgp4": "sgp4",
    "sgp-4": "sgp4",
    "two-body": "two-body",
    "two_body": "two-body",
    "twobody": "two-body",
    "kepler": "two-body",
    "keplerian": "two-body",
    "j2-j3-j4": "j2-j3-j4",
    "j2_j3_j4": "j2-j3-j4",
    "j2j3j4": "j2-j3-j4",
    "j2-j3j4": "j2-j3-j4",
    "j2j3-j4": "j2-j3-j4",
    # Cowell is an explicit numerical propagator.  It is intentionally not
    # an alias of the fixed J2/J3/J4 preset: callers choose its force model
    # separately through ``propagationOptions.cowellGravityModel``.
    "cowell": "cowell-rk4",
    "cowell-rk4": "cowell-rk4",
    "cowell-runge-kutta-4": "cowell-rk4",
    "rk4": "cowell-rk4",
}

COWELL_GRAVITY_MODELS = ("two-body", "j2", "j2-j3-j4")
_COWELL_GRAVITY_MODEL_ALIASES = {
    "two-body": "two-body",
    "two_body": "two-body",
    "twobody": "two-body",
    "central": "two-body",
    "central-gravity": "two-body",
    "j2": "j2",
    "j2-j3-j4": "j2-j3-j4",
    "j2_j3_j4": "j2-j3-j4",
    "j2j3j4": "j2-j3-j4",
}

# ``force_terms`` is the authoritative Cowell configuration. Central gravity
# cannot be disabled because a bounded Earth orbit requires it; J2/J3/J4 and
# drag are independently selectable additions. The order is part of the
# persisted representation so semantically identical requests have one stable
# cache/project identity.
COWELL_FORCE_TERMS = (
    "central",
    "j2",
    "j3",
    "j4",
    "drag",
    "geopotential",
    "third-body-sun",
    "third-body-moon",
    "solar-radiation-pressure",
    "relativity",
)
# EGM2008 is complete to degree/order 2159 (with a few additional degree-2190
# coefficients).  This is the public data-contract ceiling: a UI may express
# the full field's scientifically meaningful degree/order, even though the
# current pure-Python fixed-step evaluator separately applies a fail-closed
# execution-cost budget before attempting an expensive propagation.
MAX_MANUAL_COWELL_GEOPOTENTIAL_DEGREE = 2159
# Start new designs from the smallest physically complete model. Additional
# harmonics are opt-in force terms of Cowell/RK4; they are never implied by an
# unrelated propagation family such as two-body.
DEFAULT_COWELL_FORCE_TERMS = ("central",)
_COWELL_FORCE_TERM_ALIASES = {
    "central": "central",
    "central-gravity": "central",
    "two-body": "central",
    "two-body-gravity": "central",
    "j2": "j2",
    "j3": "j3",
    "j4": "j4",
    "drag": "drag",
    "atmospheric-drag": "drag",
    "atmospheric": "drag",
    "geopotential": "geopotential",
    "gravity-field": "geopotential",
    "full-geopotential": "geopotential",
    "third-body-sun": "third-body-sun",
    "sun": "third-body-sun",
    "solar-gravity": "third-body-sun",
    "third-body-moon": "third-body-moon",
    "moon": "third-body-moon",
    "lunar-gravity": "third-body-moon",
    "solar-radiation-pressure": "solar-radiation-pressure",
    "srp": "solar-radiation-pressure",
    "solar-pressure": "solar-radiation-pressure",
    "relativity": "relativity",
    "schwarzschild": "relativity",
}
_LEGACY_GRAVITY_MODEL_FORCE_TERMS = {
    "two-body": ("central",),
    # This is a Cowell force-model preset, not the removed standalone
    # analytical J2 propagator. Keep it so legacy Cowell payloads such as
    # ``cowellGravityModel: j2`` expand to the equivalent explicit terms.
    "j2": ("central", "j2"),
    "j2-j3-j4": ("central", "j2", "j3", "j4"),
}

# These engines are retained only for records created before force-model and
# integrator selection were separated.  Their force composition is fixed by
# the implementation, so a request must never report a different composition
# merely because it carried stale Cowell controls in its project payload.
_FIXED_MANUAL_PROPAGATOR_FORCE_TERMS = {
    # Retained only to normalize stale project data before the runtime emits
    # the explicit unavailable-SGP4 diagnostic.
    "sgp4": ("central",),
    "two-body": ("central",),
    "j2-j3-j4": ("central", "j2", "j3", "j4"),
}

NUMERICAL_INTEGRATORS = ("rk4",)
_NUMERICAL_INTEGRATOR_ALIASES = {
    "rk4": "rk4",
    "runge-kutta-4": "rk4",
    "runge-kutta4": "rk4",
    "rungekutta4": "rk4",
}


def normalize_manual_orbit_propagator(value: str) -> str:
    """Return the persisted manual-orbit propagator ID.

    Selectable IDs are listed in :data:`MANUAL_ORBIT_PROPAGATORS`; persisted
    legacy IDs are accepted here only so old project records can deserialize.
    Call :func:`require_manual_orbit_runtime_propagator` before instantiating
    an engine. Editor-friendly spellings such as ``kepler`` still normalize at
    the HTTP boundary.
    """

    normalized = re.sub(r"-+", "-", re.sub(r"[\s_+/]+", "-", str(value or "").strip().lower())).strip("-")
    canonical = _MANUAL_ORBIT_PROPAGATOR_ALIASES.get(normalized)
    if canonical is None:
        available = ", ".join(MANUAL_ORBIT_PROPAGATORS)
        raise ValueError(
            f"Propagador manual no compatible '{value}'. Seleccionables: {available}"
        )
    return canonical


def require_manual_orbit_runtime_propagator(value: str) -> str:
    """Return a manual engine that may run, rejecting legacy synthetic SGP4.

    Keeping ``sgp4`` recognizable in the normalizer avoids silently changing
    saved projects into a different physical model. Runtime/API paths must
    nevertheless reject it, because manual EME2000 elements are not NORAD TLE
    mean elements and cannot be passed straight to SGP4.
    """

    canonical = normalize_manual_orbit_propagator(value)
    if canonical == "sgp4":
        raise ValueError(MANUAL_ORBIT_SGP4_UNAVAILABLE_MESSAGE)
    return canonical


def fixed_force_terms_for_manual_propagator(propagator: str) -> tuple[str, ...] | None:
    """Return an engine's immutable force composition, if it has one.

    ``cowell-rk4`` intentionally returns ``None`` because it is the one
    configurable numerical engine.  All other accepted IDs have a fixed
    physical implementation, including the legacy records kept for backward
    compatibility.
    """

    return _FIXED_MANUAL_PROPAGATOR_FORCE_TERMS.get(
        normalize_manual_orbit_propagator(propagator)
    )


def normalize_cowell_gravity_model(value: str) -> str:
    """Return the canonical force-model ID used by ``cowell-rk4``.

    The force model deliberately remains a separate field from the public
    propagation-family ID. ``j2-j3-j4`` selects central gravity plus the
    first three zonal harmonics for Cowell; the same spelling is retained as
    a legacy preset only for old saved projects. Cowell is the configurable
    numerical route and the only native route that can include drag.
    """

    normalized = re.sub(r"-+", "-", re.sub(r"[\s_+/]+", "-", str(value or "").strip().lower())).strip("-")
    canonical = _COWELL_GRAVITY_MODEL_ALIASES.get(normalized)
    if canonical is None:
        available = ", ".join(COWELL_GRAVITY_MODELS)
        raise ValueError(f"Modelo de fuerza Cowell no compatible '{value}'. Disponibles: {available}")
    return canonical


def _compatibility_bool(value: object) -> bool:
    """Interpret the small boolean vocabulary accepted by Pydantic fields."""

    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {"false", "0", "off", "no", "n"}:
            return False
        if normalized in {"true", "1", "on", "yes", "y"}:
            return True
    return bool(value)


def force_terms_from_legacy_cowell_model(
    gravity_model: str,
    *,
    atmospheric_drag: bool = False,
) -> tuple[str, ...]:
    """Translate a pre-composition gravity preset without changing physics."""

    canonical = normalize_cowell_gravity_model(gravity_model)
    terms = _LEGACY_GRAVITY_MODEL_FORCE_TERMS[canonical]
    return (*terms, "drag") if atmospheric_drag else terms


def normalize_cowell_force_terms(value: object) -> tuple[str, ...]:
    """Return ordered, deduplicated Cowell force terms with central gravity.

    Modern callers send an array such as ``["central", "j2", "drag"]``.
    A compact string is tolerated for direct API clients, including the old
    full-preset spellings, but the returned contract is always the explicit
    ordered tuple. The presence of ``drag`` is authoritative over legacy
    ``atmosphericDrag`` aliases.
    """

    if isinstance(value, str):
        raw_text = value.strip()
        if not raw_text:
            raw_terms: list[object] = []
        else:
            try:
                # Preserve the old exact preset spellings before splitting
                # their hyphens into unrelated tokens.
                return force_terms_from_legacy_cowell_model(raw_text)
            except ValueError:
                raw_terms = [piece for piece in re.split(r"[,;|+/\s]+", raw_text) if piece]
    elif isinstance(value, (list, tuple, set, frozenset)):
        raw_terms = list(value)
    else:
        raise ValueError("force_terms debe ser una lista de términos de fuerza")

    selected = {"central"}
    for raw_term in raw_terms:
        normalized = re.sub(
            r"-+",
            "-",
            re.sub(r"[\s_+/]+", "-", str(raw_term or "").strip().lower()),
        ).strip("-")
        canonical = _COWELL_FORCE_TERM_ALIASES.get(normalized)
        if canonical is None:
            available = ", ".join(COWELL_FORCE_TERMS)
            raise ValueError(f"Término de fuerza Cowell no compatible '{raw_term}'. Disponibles: {available}")
        selected.add(canonical)
    return tuple(term for term in COWELL_FORCE_TERMS if term in selected)


def preserve_cowell_force_terms(value: object) -> tuple[str, ...]:
    """Keep future/stale terms until the active engine is known.

    Nested propagation options are validated before their parent request's
    propagator. A fixed engine must be able to ignore a future *non-drag*
    Cowell term from a project created by a newer client, whereas Cowell
    itself must still reject that term at execution time. Known terms are
    canonicalised here; unknown identifiers are retained only for that later
    engine-scoped check. Explicit drag remains a product-level error outside
    Cowell/RK4.
    """

    if isinstance(value, str):
        raw_text = value.strip()
        if not raw_text:
            raw_terms: list[object] = []
        else:
            try:
                return force_terms_from_legacy_cowell_model(raw_text)
            except ValueError:
                raw_terms = [piece for piece in re.split(r"[,;|+/\s]+", raw_text) if piece]
    elif isinstance(value, (list, tuple, set, frozenset)):
        raw_terms = list(value)
    else:
        raise ValueError("force_terms must be a list of force-term identifiers")

    selected = {"central"}
    unknown: list[str] = []
    for raw_term in raw_terms:
        normalized = re.sub(
            r"-+",
            "-",
            re.sub(r"[\s_+/]+", "-", str(raw_term or "").strip().lower()),
        ).strip("-")
        if not normalized:
            raise ValueError("force_terms cannot contain an empty force-term identifier")
        canonical = _COWELL_FORCE_TERM_ALIASES.get(normalized)
        if canonical is not None:
            selected.add(canonical)
        elif normalized not in unknown:
            unknown.append(normalized)
    return (
        *(term for term in COWELL_FORCE_TERMS if term in selected),
        *unknown,
    )


def legacy_cowell_gravity_model_from_force_terms(force_terms: object) -> str | None:
    """Project explicit terms to an old preset only when it is exact."""

    terms = normalize_cowell_force_terms(force_terms)
    gravity_terms = tuple(term for term in terms if term != "drag")
    for model, candidate in _LEGACY_GRAVITY_MODEL_FORCE_TERMS.items():
        if gravity_terms == candidate:
            return model
    return None


def normalize_numerical_integrator(value: str) -> str:
    """Return the canonical integration algorithm for Cowell propagation.

    RK4 is the only exposed numerical integrator today. Keeping this as an
    explicit contract field makes future additions (for example DOP853 or
    Gauss-Jackson) independent from the force-model choices.
    """

    normalized = re.sub(r"-+", "-", re.sub(r"[\s_+/]+", "-", str(value or "").strip().lower())).strip("-")
    canonical = _NUMERICAL_INTEGRATOR_ALIASES.get(normalized)
    if canonical is None:
        available = ", ".join(NUMERICAL_INTEGRATORS)
        raise ValueError(f"Integrador numÃ©rico no compatible '{value}'. Disponibles: {available}")
    return canonical


class TleSourceRequest(BaseModel):
    """Request base that accepts either a known satellite or explicit TLE lines."""

    sat_id: str | None = None
    line1: str | None = None
    line2: str | None = None

    @model_validator(mode="after")
    def validate_source(self):
        has_satellite = bool(self.sat_id and self.sat_id.strip())
        has_tle = bool(self.line1 and self.line2 and self.line1.strip() and self.line2.strip())
        if not has_satellite and not has_tle:
            raise ValueError("Debes enviar sat_id o line1+line2")
        return self


class PropagationRequest(TleSourceRequest):
    at: datetime.datetime | None = None


class OrbitRequest(TleSourceRequest):
    # The anchor is particularly important for tabular SP3/OEM-like sources:
    # their valid window is finite and may be historical relative to wall
    # clock.  Omitting it preserves the legacy ``utc_now()`` behaviour.
    at: datetime.datetime | None = None
    horizon_hours: float = Field(
        default=12.0,
        ge=PROPAGATION_HOURS_MIN,
        le=PROPAGATION_HOURS_MAX,
    )
    samples: int | None = Field(default=None, ge=2, le=AUTO_MAX_ORBIT_SAMPLES)


class PreciseProductFileUpload(BaseModel):
    """One browser-uploaded local SP3/CLK file encoded as base64.

    The application service performs the authoritative binary/archive limits
    and checksum validation.  This model keeps aliases stable for browser
    clients while rejecting obviously oversized JSON fields before decoding.
    """

    model_config = ConfigDict(populate_by_name=True)

    name: str = Field(min_length=1, max_length=180)
    kind: str | None = Field(
        default=None,
        validation_alias=AliasChoices("kind", "file_kind", "fileKind"),
    )
    content_base64: str = Field(
        validation_alias=AliasChoices("content_base64", "contentBase64"),
        min_length=1,
        # 32 MiB binary in canonical base64 plus a small padding allowance.
        max_length=((32 * 1024 * 1024 * 4) // 3) + 16,
    )

    @field_validator("name")
    @classmethod
    def validate_upload_name(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned or "\x00" in cleaned:
            raise ValueError("El nombre del fichero preciso no es válido")
        return cleaned

    @field_validator("kind", mode="before")
    @classmethod
    def validate_upload_kind(cls, value: object) -> str | None:
        if value is None:
            return None
        normalized = str(value).strip().lower()
        if not normalized:
            return None
        if normalized not in _PRECISE_PRODUCT_UPLOAD_KINDS:
            raise ValueError("El tipo de fichero GNSS no es válido")
        return normalized


class PreciseProductImportRequest(BaseModel):
    """Local GNSS product import with typed optional companion slots.

    ``files`` remains the compatibility transport for existing browser
    clients and archive imports.  New import dialogs can send the named slots
    directly.  They may send both during a staged rollout: ``uploads``
    deduplicates byte-identical entries before the authoritative backend
    parser validates the product.
    """

    model_config = ConfigDict(populate_by_name=True)

    files: list[PreciseProductFileUpload] = Field(default_factory=list, max_length=8)
    sp3: PreciseProductFileUpload | None = Field(
        default=None,
        validation_alias=AliasChoices("sp3", "sp3File", "sp3_file", "SP3"),
    )
    clk: PreciseProductFileUpload | None = Field(
        default=None,
        validation_alias=AliasChoices("clk", "clkFile", "clk_file", "CLK"),
    )
    erp: PreciseProductFileUpload | None = Field(
        default=None,
        validation_alias=AliasChoices("erp", "erpFile", "erp_file", "ERP"),
    )
    sum: PreciseProductFileUpload | None = Field(
        default=None,
        validation_alias=AliasChoices("sum", "sumFile", "sum_file", "SUM"),
    )
    att: PreciseProductFileUpload | None = Field(
        default=None,
        validation_alias=AliasChoices("att", "attFile", "att_file", "ATT"),
    )
    osb: PreciseProductFileUpload | None = Field(
        default=None,
        validation_alias=AliasChoices("osb", "osbFile", "osb_file", "OSB"),
    )
    require_eci: bool = Field(
        default=False,
        validation_alias=AliasChoices(
            "require_eci",
            "requireEci",
            "requireEciConversion",
            "enable_eci_conversion",
            "enableEciConversion",
        ),
    )
    provider_hint: str = Field(
        default="auto",
        validation_alias=AliasChoices("provider_hint", "providerHint", "provider"),
        max_length=40,
    )
    product_class: str = Field(
        default="auto",
        validation_alias=AliasChoices("product_class", "productClass", "class"),
        max_length=40,
    )
    selected_satellite_ids: list[str] | None = Field(
        default=None,
        validation_alias=AliasChoices(
            "selected_satellite_ids",
            "selectedSatelliteIds",
            "selectedSatellites",
        ),
        # SP3-d can carry a large multi-GNSS constellation. Keep a bounded
        # request while still allowing an operator to choose every member of
        # a product rather than unexpectedly rejecting "Select all".
        max_length=1000,
    )

    @field_validator("provider_hint", "product_class", mode="before")
    @classmethod
    def require_automatic_product_metadata(cls, value: object) -> str:
        """Keep provenance and class derived from the imported product.

        Older browser builds still send these fields with the value ``auto``.
        Retaining that one value avoids a rollout break, but accepting a
        provider or class chosen by the client would let a local filename be
        misrepresented as an IGS, MGEX or ESA product.  The application
        service is the sole authority and derives both values from the source
        members.
        """

        normalized = str(value or "auto").strip().lower()
        if normalized in {"", "auto"}:
            return "auto"
        raise ValueError(
            "La procedencia y la clase del producto se determinan automáticamente a partir de los ficheros."
        )

    @field_validator("selected_satellite_ids")
    @classmethod
    def validate_selected_precise_satellites(cls, value: list[str] | None) -> list[str] | None:
        """Normalize an optional SP3 subset without trusting it as product data.

        The source SP3 remains authoritative: this boundary only keeps a
        malformed browser selection from reaching the parser.  Membership is
        checked later against the parsed product, where archive contents are
        known.  ``None`` intentionally means the legacy/direct-import
        behaviour of importing every satellite in the SP3.
        """

        if value is None:
            return None
        if not value:
            raise ValueError("Seleccione al menos un satélite del SP3.")
        normalized: list[str] = []
        for raw_identifier in value:
            identifier = str(raw_identifier or "").strip().upper()
            if not re.fullmatch(r"[A-Z0-9]{1,12}", identifier):
                raise ValueError("El identificador de satélite preciso no es válido")
            normalized.append(identifier)
        if len(set(normalized)) != len(normalized):
            raise ValueError("Los satélites seleccionados no pueden repetirse.")
        return normalized

    @model_validator(mode="after")
    def validate_declared_product_file_kinds(self) -> "PreciseProductImportRequest":
        """Reject a browser-declared kind that contradicts its filename.

        The importer remains the authority for archive inspection and content
        parsing.  This check only prevents a client from presenting a CLK as
        an ERP (or a named ``sp3`` slot as a different product member) before
        it reaches that boundary.
        """

        for upload in self.files:
            _validate_precise_upload_kind(upload)
        for slot, upload in (
            ("sp3", self.sp3),
            ("clk", self.clk),
            ("erp", self.erp),
            ("sum", self.sum),
            ("att", self.att),
            ("osb", self.osb),
        ):
            if upload is None:
                continue
            _validate_precise_upload_kind(upload, expected_slot=slot)
        return self

    def uploads(self) -> list[PreciseProductFileUpload]:
        """Return every logical upload once, preserving slot identity.

        ``name`` plus base64 bytes is the appropriate deduplication key at
        the request boundary: two identical slot/list entries are one file,
        while different bytes under the same name are deliberately kept so
        the application service can reject unsafe duplicate sources.
        """

        candidates = [*self.files, self.sp3, self.clk, self.erp, self.sum, self.att, self.osb]
        resolved: list[PreciseProductFileUpload] = []
        seen: set[tuple[str, str]] = set()
        for upload in candidates:
            if upload is None:
                continue
            key = (upload.name.casefold(), upload.content_base64)
            if key in seen:
                continue
            seen.add(key)
            resolved.append(upload)
        return resolved


_PRECISE_PRODUCT_UPLOAD_KINDS = frozenset({"sp3", "clk", "erp", "sum", "att", "osb", "archive"})
_PRECISE_PRODUCT_NAMED_SLOT_SUFFIXES = {
    "sp3": (".sp3", ".sp3.gz"),
    "clk": (".clk", ".clk.gz"),
    "erp": (".erp", ".erp.gz"),
    # Published summaries are commonly compressed with the rest of the
    # GNSS bundle.  Treat ``.SUM.gz`` as the same logical SUM member rather
    # than making the browser unpack it first.
    "sum": (".sum", ".sum.gz"),
    # Most IGS long filenames use ATT.OBX / OSB.BIA.  Some providers expose
    # the same logical payload with an ATT, OBX or BIA final suffix; accept
    # those compatible aliases while preserving the explicit ATT/OSB identity.
    "att": (".att.obx", ".att.obx.gz", ".att", ".att.gz", ".obx", ".obx.gz"),
    "osb": (".osb.bia", ".osb.bia.gz", ".bia", ".bia.gz"),
}


def _precise_product_filename_kind(name: str) -> str | None:
    """Classify the published GNSS filename suffix without reading bytes."""

    lowered = str(name or "").strip().casefold()
    if lowered.endswith(".zip"):
        return "archive"
    if lowered.endswith((".gz", ".z")):
        lowered = lowered.rsplit(".", 1)[0]
    if lowered.endswith((".sp3", ".sp3c", ".sp3d")):
        return "sp3"
    if lowered.endswith((".clk", ".clk_30s", ".clk_05s")):
        return "clk"
    if lowered.endswith(".erp"):
        return "erp"
    if lowered.endswith(".sum"):
        return "sum"
    if lowered.endswith((".att.obx", ".att", ".obx")):
        return "att"
    if lowered.endswith((".osb.bia", ".bia")):
        return "osb"
    return None


def _validate_precise_upload_kind(
    upload: PreciseProductFileUpload,
    *,
    expected_slot: str | None = None,
) -> None:
    """Ensure optional browser ``kind`` agrees with suffix and slot."""

    inferred = _precise_product_filename_kind(upload.name)
    if expected_slot is not None and upload.kind not in {None, expected_slot}:
        raise ValueError(
            f"El campo {expected_slot.upper()} no puede declarar el tipo {upload.kind.upper()}"
        )
    if expected_slot is not None:
        canonical_suffixes = _PRECISE_PRODUCT_NAMED_SLOT_SUFFIXES[expected_slot]
        if not upload.name.casefold().endswith(canonical_suffixes):
            readable = " o ".join(suffix.upper() for suffix in canonical_suffixes)
            raise ValueError(
                f"El campo {expected_slot.upper()} solo admite ficheros {readable}"
            )
    if inferred is None:
        raise ValueError(f"{upload.name} no tiene una extensión GNSS reconocida")
    if upload.kind is not None and upload.kind != inferred:
        raise ValueError(
            f"El tipo declarado {upload.kind.upper()} no coincide con la extensión de {upload.name}"
        )


def _azimuth_within_limits(azimuth_deg: float, minimum_deg: float, maximum_deg: float) -> bool:
    """Return whether an azimuth belongs to a wrapped mechanical interval."""
    azimuth = ((float(azimuth_deg) + 180.0) % 360.0) - 180.0
    minimum = ((float(minimum_deg) + 180.0) % 360.0) - 180.0
    maximum = ((float(maximum_deg) + 180.0) % 360.0) - 180.0
    if math.isclose(minimum, maximum, abs_tol=1e-12):
        return True
    return minimum <= azimuth <= maximum if minimum <= maximum else azimuth >= minimum or azimuth <= maximum


class StationInput(BaseModel):
    lat_deg: float = Field(ge=-90, le=90)
    lon_deg: float = Field(ge=-180, le=180)
    height_m: float = Field(default=0.0, ge=-1_000, le=100_000)
    min_elevation_deg: float = Field(default=10.0, ge=0, le=90)
    # Optional RF slant-range gate. This is an operational value, deliberately
    # independent from the shorter renderer range used to keep a 3D lobe
    # responsive. One million km is a safety bound for malformed requests and
    # remains well beyond ordinary Earth-orbit access planning.
    max_range_km: float | None = Field(default=None, gt=0, le=1_000_000)
    # Mechanical and pointing data are operational geometry, not propagation
    # inputs. They are kept with the station request so all AOS/LOS consumers
    # agree with the live scene about what the antenna can physically reach.
    mechanical_elevation_min_deg: float = Field(default=0.0, ge=0, le=90)
    mechanical_elevation_max_deg: float = Field(default=90.0, ge=0, le=90)
    mechanical_azimuth_min_deg: float = Field(default=-180.0, ge=-180, le=180)
    mechanical_azimuth_max_deg: float = Field(default=180.0, ge=-180, le=180)
    operation_mode: Literal["tracking", "scan", "stationary"] = "tracking"
    boresight_azimuth_deg: float = Field(default=0.0, ge=-180, le=180)
    boresight_elevation_deg: float = Field(default=90.0, ge=0, le=90)
    # Retained for legacy callers that only supplied a circular fixed-beam
    # description. New callers provide the two HPBW values and a pattern; the
    # half-power contour is a diagnostic, while the directional budget is the
    # actual stationary-station range gate. Scan is intentionally a
    # field-of-regard model until a time-tagged scan schedule exists; the
    # AOS/LOS route reports it as potential coverage, never as an operational
    # peak-gain pass.
    beam_half_angle_deg: float | None = Field(default=None, gt=0, le=90)
    # The backend needs the same angular pattern contract as the browser when
    # it turns the boresight range into an operational AOS/LOS range. These
    # fields are optional for compatibility with older API clients; a
    # stationary request falls back to its declared beam half-angle.
    pattern_type: Literal["gaussian", "cosine"] = "gaussian"
    hpbw_azimuth_deg: float | None = Field(default=None, gt=0, le=180)
    hpbw_elevation_deg: float | None = Field(default=None, gt=0, le=180)
    side_lobe_level_db: float = Field(default=25.0, ge=0, le=120)

    @model_validator(mode="after")
    def validate_mechanical_elevation_limits(self):
        if self.mechanical_elevation_min_deg > self.mechanical_elevation_max_deg:
            raise ValueError("mechanical_elevation_min_deg no puede superar mechanical_elevation_max_deg")
        if self.operation_mode == "stationary":
            if not self.mechanical_elevation_min_deg <= self.boresight_elevation_deg <= self.mechanical_elevation_max_deg:
                raise ValueError("el boresight de elevacion debe estar dentro de los limites mecanicos")
            if not _azimuth_within_limits(
                self.boresight_azimuth_deg,
                self.mechanical_azimuth_min_deg,
                self.mechanical_azimuth_max_deg,
            ):
                raise ValueError("el boresight de azimut debe estar dentro de los limites mecanicos")
        return self


class EphemerisRequest(TleSourceRequest):
    start_time: datetime.datetime
    end_time: datetime.datetime
    step_seconds: float = Field(default=30.0, gt=0, le=3600)
    include_velocity: bool = True

    @model_validator(mode="after")
    def validate_time_range(self):
        if self.end_time <= self.start_time:
            raise ValueError("end_time debe ser mayor que start_time")
        return self


class CartesianVectorInput(BaseModel):
    """A finite three-component vector used by the manual-orbit API."""

    x: float
    y: float
    z: float

    @field_validator("x", "y", "z")
    @classmethod
    def validate_finite_component(cls, value: float) -> float:
        if not math.isfinite(value):
            raise ValueError("Los componentes del vector deben ser finitos")
        return value


class ManualKeplerianInput(BaseModel):
    """Classical elliptic elements accepted by the manual-orbit editor.

    The public API accepts its snake_case fields as well as the camelCase
    names emitted by the React editor.  Angles are expressed in degrees and
    the semi-major axis is expressed in kilometres.
    """

    model_config = ConfigDict(populate_by_name=True)

    reference_frame: str = Field(
        default="EME2000",
        validation_alias=AliasChoices("reference_frame", "referenceFrame"),
    )
    time_scale: Literal["UTC"] = Field(
        default="UTC",
        validation_alias=AliasChoices("time_scale", "timeScale"),
    )

    semi_major_axis_km: float = Field(
        validation_alias=AliasChoices("semi_major_axis_km", "semiMajorAxisKm"),
        gt=0,
        le=500_000,
    )
    eccentricity: float = Field(ge=0, lt=1)
    inclination_deg: float = Field(
        validation_alias=AliasChoices("inclination_deg", "inclinationDeg"),
        ge=0,
        le=180,
    )
    raan_deg: float = Field(
        validation_alias=AliasChoices("raan_deg", "raanDeg"),
    )
    argument_of_perigee_deg: float = Field(
        validation_alias=AliasChoices(
            "argument_of_perigee_deg",
            "argumentOfPerigeeDeg",
            "argument_of_periapsis_deg",
            "argumentOfPeriapsisDeg",
        ),
    )
    true_anomaly_deg: float | None = Field(
        default=None,
        validation_alias=AliasChoices("true_anomaly_deg", "trueAnomalyDeg"),
    )
    mean_anomaly_deg: float | None = Field(
        default=None,
        validation_alias=AliasChoices("mean_anomaly_deg", "meanAnomalyDeg"),
    )

    @field_validator(
        "semi_major_axis_km",
        "eccentricity",
        "inclination_deg",
        "raan_deg",
        "argument_of_perigee_deg",
        "true_anomaly_deg",
        "mean_anomaly_deg",
    )
    @classmethod
    def validate_finite_value(cls, value: float | None) -> float | None:
        if value is not None and not math.isfinite(value):
            raise ValueError("Los elementos keplerianos deben ser finitos")
        return value

    @field_validator("reference_frame", mode="before")
    @classmethod
    def normalize_reference_frame(cls, value: object) -> str:
        """Accept historical ECI input only as an explicit EME2000 migration."""

        label = "".join(character for character in str(value or "EME2000").upper() if character.isalnum())
        if label in {"EME2000", "EME2K", "J2000", "ECI"}:
            return "EME2000"
        raise ValueError("Los elementos manuales deben declarar EME2000; ECI genÃ©rico no es un marco nuevo vÃ¡lido")

    @model_validator(mode="after")
    def validate_anomaly(self):
        if self.true_anomaly_deg is None and self.mean_anomaly_deg is None:
            raise ValueError("Debes enviar true_anomaly_deg o mean_anomaly_deg")
        return self


class ManualStateVectorInput(BaseModel):
    """EME2000 Cartesian state in km and km/s for a manual orbit.

    Besides the canonical nested shape, this model accepts the six flat
    camelCase fields used by the editor.  Keeping the compatibility here
    leaves the HTTP boundary stable while the editor evolves.
    """

    model_config = ConfigDict(populate_by_name=True)

    reference_frame: str = Field(
        default="EME2000",
        validation_alias=AliasChoices("reference_frame", "referenceFrame"),
    )
    time_scale: Literal["UTC"] = Field(
        default="UTC",
        validation_alias=AliasChoices("time_scale", "timeScale"),
    )
    position_eme2000_km: CartesianVectorInput = Field(
        validation_alias=AliasChoices(
            "position_eme2000_km", "positionEme2000Km",
            "position_eci_km", "positionEciKm", "position_km", "positionKm",
        ),
    )
    velocity_eme2000_km_s: CartesianVectorInput = Field(
        validation_alias=AliasChoices(
            "velocity_eme2000_km_s", "velocityEme2000KmS",
            "velocity_eci_km_s", "velocityEciKmS", "velocity_km_s", "velocityKmS",
        ),
    )

    @field_validator("reference_frame", mode="before")
    @classmethod
    def normalize_reference_frame(cls, value: object) -> str:
        label = "".join(character for character in str(value or "EME2000").upper() if character.isalnum())
        if label in {"EME2000", "EME2K", "J2000", "ECI"}:
            return "EME2000"
        raise ValueError("El vector manual debe declarar EME2000; ECI genÃ©rico no es un marco nuevo vÃ¡lido")

    @property
    def position_eci_km(self) -> CartesianVectorInput:
        """Temporary read-only alias for persisted pre-frame-contract records."""

        return self.position_eme2000_km

    @property
    def velocity_eci_km_s(self) -> CartesianVectorInput:
        """Temporary read-only alias for persisted pre-frame-contract records."""

        return self.velocity_eme2000_km_s

    @model_validator(mode="before")
    @classmethod
    def accept_flat_editor_fields(cls, value):
        if not isinstance(value, dict):
            return value
        payload = dict(value)
        if not any(key in payload for key in (
            "position_eme2000_km", "positionEme2000Km", "position_eci_km", "positionEciKm", "position_km", "positionKm",
        )):
            keys = ("positionXKm", "positionYKm", "positionZKm")
            if any(key in payload for key in keys):
                payload["positionEme2000Km"] = {
                    "x": payload.get("positionXKm"),
                    "y": payload.get("positionYKm"),
                    "z": payload.get("positionZKm"),
                }
        if not any(key in payload for key in (
            "velocity_eme2000_km_s", "velocityEme2000KmS", "velocity_eci_km_s", "velocityEciKmS", "velocity_km_s", "velocityKmS",
        )):
            keys = ("velocityXKmS", "velocityYKmS", "velocityZKmS")
            if any(key in payload for key in keys):
                payload["velocityEme2000KmS"] = {
                    "x": payload.get("velocityXKmS"),
                    "y": payload.get("velocityYKmS"),
                    "z": payload.get("velocityZKmS"),
                }
        return payload


class ManualPropagationOptions(BaseModel):
    """First-order configuration for native manual propagation.

    ``force_terms`` is the canonical force composition for ``cowell-rk4``:
    ``central`` is always present.  Legacy ``j2``/``j3``/``j4`` and ``drag``
    remain independent compatibility terms.  New physical terms are the
    configured ICGEM ``geopotential``, Sun/Moon third bodies, cannonball SRP
    and first-order Schwarzschild relativity. ``atmospheric_drag`` and the former
    ``cowell_gravity_model``/``forceModel`` fields are accepted as derived
    compatibility inputs only. ``numerical_integrator`` independently selects
    the integration algorithm. ``drag_coefficient * area_m2 / mass_kg`` is
    the ballistic factor when the canonical terms include ``drag``.
    """

    model_config = ConfigDict(populate_by_name=True)

    force_terms: tuple[str, ...] = Field(
        default=DEFAULT_COWELL_FORCE_TERMS,
        validation_alias=AliasChoices(
            "force_terms",
            "forceTerms",
            "gravity_terms",
            "gravityTerms",
        ),
    )
    atmospheric_drag: bool = Field(
        default=False,
        validation_alias=AliasChoices("atmospheric_drag", "atmosphericDrag"),
    )
    numerical_integrator: str = Field(
        default="rk4",
        validation_alias=AliasChoices("numerical_integrator", "numericalIntegrator"),
    )
    drag_coefficient: float = Field(
        default=2.2,
        validation_alias=AliasChoices("drag_coefficient", "dragCoefficient"),
        gt=0,
        le=10,
    )
    area_m2: float = Field(
        default=1.0,
        validation_alias=AliasChoices("area_m2", "areaM2"),
        gt=0,
        le=100_000,
    )
    mass_kg: float = Field(
        default=100.0,
        validation_alias=AliasChoices("mass_kg", "massKg"),
        gt=0,
        le=10_000_000,
    )
    geopotential_degree: int = Field(
        default=4,
        validation_alias=AliasChoices("geopotential_degree", "geopotentialDegree"),
        ge=0,
        le=MAX_MANUAL_COWELL_GEOPOTENTIAL_DEGREE,
    )
    geopotential_order: int = Field(
        default=0,
        validation_alias=AliasChoices("geopotential_order", "geopotentialOrder"),
        ge=0,
        le=MAX_MANUAL_COWELL_GEOPOTENTIAL_DEGREE,
    )
    solar_radiation_coefficient: float = Field(
        default=1.2,
        validation_alias=AliasChoices(
            "solar_radiation_coefficient",
            "solarRadiationCoefficient",
            "reflectivity_coefficient",
            "reflectivityCoefficient",
            "cr",
        ),
        gt=0,
        le=5,
    )

    @model_validator(mode="before")
    @classmethod
    def normalize_force_terms_and_legacy_inputs(cls, value):
        """Make modern explicit terms authoritative over legacy aliases."""

        if not isinstance(value, dict):
            return value
        payload = dict(value)
        modern_terms = next(
            (
                payload[key]
                for key in ("force_terms", "forceTerms", "gravity_terms", "gravityTerms")
                if key in payload and payload[key] is not None
            ),
            None,
        )
        if modern_terms is not None:
            payload["forceTerms"] = modern_terms
            return payload

        legacy_model = next(
            (
                payload[key]
                for key in (
                    "cowell_gravity_model",
                    "cowellGravityModel",
                    "force_model",
                    "forceModel",
                    "gravity_model",
                    "gravityModel",
                )
                if key in payload and payload[key] is not None
            ),
            None,
        )
        legacy_drag = next(
            (
                payload[key]
                for key in ("atmospheric_drag", "atmosphericDrag")
                if key in payload and payload[key] is not None
            ),
            False,
        )
        # A completely clean object is a new design and starts with central
        # gravity only. A non-empty legacy options payload without an explicit
        # model historically implied the full zonal preset, in particular a
        # drag-only payload; preserve that old physical interpretation.
        legacy_option_keys = {
            "atmospheric_drag",
            "atmosphericDrag",
            "numerical_integrator",
            "numericalIntegrator",
            "drag_coefficient",
            "dragCoefficient",
            "area_m2",
            "areaM2",
            "mass_kg",
            "massKg",
        }
        if legacy_model is not None:
            try:
                payload["forceTerms"] = force_terms_from_legacy_cowell_model(
                    str(legacy_model),
                    atmospheric_drag=_compatibility_bool(legacy_drag),
                )
            except ValueError:
                # A future non-drag force-model preset may be present on an
                # object opened by an older backend. Keep it long enough for
                # a fixed engine to project its own terms; Cowell rejects it
                # later. An explicit drag flag is retained and rejected for
                # fixed engines instead of being silently ignored.
                payload["forceTerms"] = [
                    str(legacy_model),
                    *(["drag"] if _compatibility_bool(legacy_drag) else []),
                ]
        elif any(key in payload and payload[key] is not None for key in legacy_option_keys):
            payload["forceTerms"] = force_terms_from_legacy_cowell_model(
                "j2-j3-j4",
                atmospheric_drag=_compatibility_bool(legacy_drag),
            )
        else:
            payload["forceTerms"] = DEFAULT_COWELL_FORCE_TERMS
        return payload

    @field_validator("force_terms", mode="before")
    @classmethod
    def validate_force_terms(cls, value: object) -> tuple[str, ...]:
        return preserve_cowell_force_terms(value)

    @field_validator("numerical_integrator", mode="before")
    @classmethod
    def validate_numerical_integrator(cls, value: str) -> str:
        # The parent model determines whether the configured engine is Cowell
        # (where this is checked strictly) or a fixed engine (where a stale
        # future integrator must be ignored safely).
        candidate = str(value or "").strip()
        return candidate or "rk4"

    @field_validator("drag_coefficient", "area_m2", "mass_kg", "solar_radiation_coefficient")
    @classmethod
    def validate_finite_value(cls, value: float) -> float:
        if not math.isfinite(value):
            raise ValueError("Los parÃ¡metros de arrastre deben ser finitos")
        return float(value)

    @model_validator(mode="after")
    def synchronize_derived_drag_flag(self):
        """Keep the old boolean readable without giving it authority."""

        self.atmospheric_drag = "drag" in self.force_terms
        if self.geopotential_order > self.geopotential_degree:
            raise ValueError("geopotential_order no puede superar geopotential_degree")
        if "geopotential" in self.force_terms and self.geopotential_degree < 2:
            raise ValueError(
                "geopotential requiere geopotential_degree >= 2; "
                "J1 no es un término seleccionable en un campo centrado en el centro de masas"
            )
        return self

    @property
    def cowell_gravity_model(self) -> str | None:
        """Compatibility projection for exact historical gravity presets."""

        return legacy_cowell_gravity_model_from_force_terms(self.force_terms)

    def canonical(
        self,
        *,
        propagator: str | None = None,
    ) -> dict[str, bool | float | int | str | list[str] | None]:
        """Return the force configuration actually applied by an engine.

        Without a propagator this remains the standalone Cowell configuration
        form.  Supplying a manual engine ID projects a legacy/fixed engine to
        its true immutable terms and removes numerical-Cowell controls that
        it does not execute. This makes stale non-drag controls in old project
        JSON harmless without misreporting their physics to the UI; explicit
        atmospheric drag remains invalid outside Cowell/RK4.
        """

        canonical_propagator = (
            normalize_manual_orbit_propagator(propagator)
            if propagator is not None
            else None
        )
        if canonical_propagator is not None and canonical_propagator != "cowell-rk4":
            if self.atmospheric_drag:
                raise ValueError(
                    "atmospheric_drag is only available with the Cowell/RK4 propagator; "
                    "select cowell-rk4 and a force model"
                )
            fixed_terms = fixed_force_terms_for_manual_propagator(canonical_propagator)
            # The mapping is exhaustive for every accepted non-Cowell engine;
            # retain the guard so a future engine cannot accidentally echo
            # arbitrary, unapplied Cowell terms.
            if fixed_terms is None:
                raise ValueError(
                    f"El propagador manual '{canonical_propagator}' no declara una composición de fuerzas"
                )
            return {
                "force_terms": list(fixed_terms),
                "atmospheric_drag": False,
            }

        # Cowell is the only configurable numerical engine, so validate its
        # candidate terms/integrator at the point where they become active.
        # This intentionally rejects future values for Cowell while allowing
        # fixed engines above to ignore stale non-drag project fields safely.
        strict_force_terms = normalize_cowell_force_terms(self.force_terms)
        if "geopotential" in strict_force_terms and any(
            term in strict_force_terms for term in ("j2", "j3", "j4")
        ):
            raise ValueError(
                "geopotential no puede combinarse con j2, j3 o j4; "
                "el campo de grado/orden ya incluye esos armónicos"
            )
        strict_integrator = normalize_numerical_integrator(self.numerical_integrator)
        atmospheric_drag = "drag" in strict_force_terms
        legacy_gravity_model = legacy_cowell_gravity_model_from_force_terms(
            strict_force_terms
        )
        canonical: dict[str, bool | float | int | str | list[str] | None] = {
            "force_terms": list(strict_force_terms),
            "atmospheric_drag": atmospheric_drag,
            "numerical_integrator": strict_integrator,
            "drag_coefficient": float(self.drag_coefficient),
            "area_m2": float(self.area_m2),
            "mass_kg": float(self.mass_kg),
        }
        if "geopotential" in strict_force_terms:
            canonical["geopotential_degree"] = int(self.geopotential_degree)
            canonical["geopotential_order"] = int(self.geopotential_order)
        if "solar-radiation-pressure" in strict_force_terms:
            canonical["solar_radiation_coefficient"] = float(
                self.solar_radiation_coefficient
            )
        # Retain the old scalar only where it represents the composition
        # exactly. A null/custom pseudo-preset would be misleading and could
        # not safely round-trip through an older client.
        if legacy_gravity_model is not None:
            canonical["cowell_gravity_model"] = legacy_gravity_model
        return canonical


class ManualObjectMetadata(BaseModel):
    """Lightweight descriptive fields for a manually authored object.

    They deliberately contain no orbital state: that belongs to the Keplerian
    or Cartesian definition.  Empty UI fields normalize to ``None`` instead
    of being persisted as whitespace-only strings.
    """

    model_config = ConfigDict(populate_by_name=True)

    object_type: str | None = Field(
        default=None,
        validation_alias=AliasChoices("object_type", "objectType"),
    )
    mission_type: str | None = Field(
        default=None,
        validation_alias=AliasChoices("mission_type", "missionType"),
    )
    operator: str | None = Field(default=None)
    country: str | None = Field(default=None)
    launch_date: datetime.date | None = Field(
        default=None,
        validation_alias=AliasChoices("launch_date", "launchDate"),
    )

    @field_validator("object_type", "mission_type", "operator", "country", mode="before")
    @classmethod
    def normalize_text(cls, value: object) -> str | None:
        if value is None:
            return None
        if not isinstance(value, str):
            raise ValueError("Los metadatos del objeto deben ser texto")
        cleaned = " ".join(value.strip().split())
        if not cleaned:
            return None
        if len(cleaned) > 120:
            raise ValueError("Los metadatos del objeto no pueden superar 120 caracteres")
        return cleaned

    @field_validator("launch_date", mode="before")
    @classmethod
    def normalize_launch_date(cls, value: object) -> object:
        return None if value is None or (isinstance(value, str) and not value.strip()) else value

    def canonical(self) -> dict[str, str | None]:
        """Return the response/project snake-case form, omitting no fields."""

        return {
            "object_type": self.object_type,
            "mission_type": self.mission_type,
            "operator": self.operator,
            "country": self.country,
            "launch_date": self.launch_date.isoformat() if self.launch_date else None,
        }


class ManualErpInput(BaseModel):
    """A transient ERP upload or a durable reference for a manual orbit.

    A browser may provide ``name`` plus ``content_base64`` only while it is
    uploading a new local snapshot.  Once Orbit has accepted it, project JSON
    must contain the content-addressed ``snapshot_id`` alone (with optional
    display provenance).  Keeping both shapes in one request model lets an
    imported project be restored without ever embedding an ERP in it.
    """

    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    name: str | None = Field(default=None, min_length=1, max_length=180)
    content_base64: str | None = Field(
        default=None,
        validation_alias=AliasChoices("content_base64", "contentBase64"),
        # Same 32 MiB binary boundary as the precise-product importer.
        max_length=((32 * 1024 * 1024 * 4) // 3) + 16,
        repr=False,
    )
    snapshot_id: str | None = Field(
        default=None,
        validation_alias=AliasChoices("snapshot_id", "snapshotId", "id"),
        min_length=1,
        max_length=96,
    )

    @field_validator("name", "snapshot_id", mode="before")
    @classmethod
    def normalize_manual_erp_text(cls, value: object) -> str | None:
        if value is None:
            return None
        cleaned = str(value).strip()
        return cleaned or None

    @model_validator(mode="after")
    def validate_manual_erp_shape(self):
        has_bytes = bool(self.content_base64 and self.content_base64.strip())
        has_snapshot = bool(self.snapshot_id)
        if has_bytes and not self.name:
            raise ValueError("El ERP manual con contenido debe declarar su nombre de fichero")
        if has_bytes and has_snapshot:
            raise ValueError("El ERP manual debe enviar contenido o snapshot_id, no ambos")
        if not has_bytes and not has_snapshot:
            raise ValueError("El ERP manual requiere content_base64 o snapshot_id")
        return self

    @property
    def is_upload(self) -> bool:
        return bool(self.content_base64 and self.content_base64.strip())


class ManualOrbitTimeWindow(BaseModel):
    """One optional UTC design/scene interval used by ERP preflight."""

    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    start_time: datetime.datetime | None = Field(
        default=None,
        validation_alias=AliasChoices("start_time", "startTime"),
    )
    end_time: datetime.datetime | None = Field(
        default=None,
        validation_alias=AliasChoices("end_time", "endTime"),
    )

    @field_validator("start_time", "end_time")
    @classmethod
    def normalize_time_window_utc(cls, value: datetime.datetime | None) -> datetime.datetime | None:
        return ensure_utc(value) if value is not None else None

    @model_validator(mode="after")
    def validate_complete_window(self):
        if (self.start_time is None) != (self.end_time is None):
            raise ValueError("La ventana temporal debe declarar inicio y final")
        if self.start_time is not None and self.end_time is not None and self.end_time <= self.start_time:
            raise ValueError("El final de la ventana temporal debe ser posterior al inicio")
        return self

    def payload(self) -> dict[str, str] | None:
        if self.start_time is None or self.end_time is None:
            return None
        return {
            "start_time": self.start_time.isoformat(),
            "end_time": self.end_time.isoformat(),
            "startTime": self.start_time.isoformat(),
            "endTime": self.end_time.isoformat(),
        }


class ManualErpPreviewRequest(BaseModel):
    """ERP upload validation request for the manual TIME tab.

    A successful preview creates a local, content-addressed snapshot so the
    client can retain only its reference in the manual-orbit/project record.
    The raw upload bytes are never returned by this request's response.
    """

    model_config = ConfigDict(populate_by_name=True)

    manual_erp: ManualErpInput = Field(
        validation_alias=AliasChoices("manual_erp", "manualErp", "erp"),
    )
    design_window: ManualOrbitTimeWindow | None = Field(
        default=None,
        validation_alias=AliasChoices("design_window", "designWindow"),
    )
    scene_window: ManualOrbitTimeWindow | None = Field(
        default=None,
        validation_alias=AliasChoices("scene_window", "sceneWindow"),
    )

    @model_validator(mode="after")
    def require_upload_for_preview(self):
        if not self.manual_erp.is_upload:
            raise ValueError("La previsualización ERP requiere un fichero local")
        return self


class ManualOrbitRequest(BaseModel):
    """Validated request for a transient manual orbit.

    The selected representation is authoritative.  When both representations
    are included (the normal UI synchronization case), ``definition_source``
    picks one; Keplerian elements are used by default for backwards-compatible
    direct API clients. Native two-body and Cowell configurations use the
    canonical EME2000 definition directly. The model also recognizes legacy
    SGP4 records so callers can report them as unavailable rather than silently
    changing their dynamics; it never permits that compatibility ID to run.
    Legacy J2 records remain supported without being reinterpreted.
    """

    model_config = ConfigDict(populate_by_name=True)

    name: str = Field(default="Manual orbit", min_length=1, max_length=120)
    epoch: datetime.datetime = Field(
        validation_alias=AliasChoices("epoch", "epoch_utc", "epochUtc"),
    )
    # A manual design starts from a physical EME2000 state, so Two-body is the
    # coherent default.
    propagator: str = Field(default="two-body", min_length=1, max_length=40)
    object_metadata: ManualObjectMetadata = Field(
        default_factory=ManualObjectMetadata,
        validation_alias=AliasChoices("object_metadata", "objectMetadata"),
    )
    propagation_options: ManualPropagationOptions = Field(
        default_factory=ManualPropagationOptions,
        validation_alias=AliasChoices("propagation_options", "propagationOptions"),
    )
    manual_erp: ManualErpInput | None = Field(
        default=None,
        validation_alias=AliasChoices(
            "manual_erp", "manualErp", "manual_erp_snapshot", "manualErpSnapshot"
        ),
    )
    definition_source: Literal["keplerian", "state_vector"] | None = Field(
        default=None,
        validation_alias=AliasChoices("definition_source", "definitionSource", "source"),
    )
    keplerian: ManualKeplerianInput | None = None
    state_vector: ManualStateVectorInput | None = Field(
        default=None,
        validation_alias=AliasChoices("state_vector", "stateVector"),
    )
    start_time: datetime.datetime | None = Field(
        default=None,
        validation_alias=AliasChoices("start_time", "startTime"),
    )
    end_time: datetime.datetime | None = Field(
        default=None,
        validation_alias=AliasChoices("end_time", "endTime"),
    )
    horizon_hours: float | None = Field(
        default=None,
        validation_alias=AliasChoices("horizon_hours", "horizonHours"),
        gt=0,
        le=24.0 * 365.0,
    )
    step_seconds: float = Field(
        default=30.0,
        validation_alias=AliasChoices("step_seconds", "stepSeconds"),
        gt=0,
        le=3600,
    )
    include_velocity: bool = Field(
        default=True,
        validation_alias=AliasChoices("include_velocity", "includeVelocity"),
    )

    @model_validator(mode="before")
    @classmethod
    def accept_flat_editor_options(cls, value):
        """Accept nested API fields and the flat editor compatibility shape.

        The current React panel sends the nested camel-case variants.  Keeping
        the flat aliases here costs little and avoids a breaking request
        contract for integrations that added these inputs before the panel was
        split into dedicated tabs.
        """

        if not isinstance(value, dict):
            return value
        payload = dict(value)
        if not any(key in payload for key in ("manual_erp", "manualErp")):
            snapshot_id = next(
                (
                    payload[key]
                    for key in ("manual_erp_snapshot_id", "manualErpSnapshotId")
                    if payload.get(key) is not None
                ),
                None,
            )
            if snapshot_id is not None:
                payload["manualErp"] = {"snapshotId": snapshot_id}
        if not any(key in payload for key in ("propagation_options", "propagationOptions")):
            flat_options = {
                "forceTerms": payload.get("forceTerms", payload.get("gravityTerms")),
                "atmosphericDrag": payload.get("atmosphericDrag"),
                "cowellGravityModel": payload.get("cowellGravityModel", payload.get("forceModel")),
                "numericalIntegrator": payload.get("numericalIntegrator"),
                "dragCoefficient": payload.get("dragCoefficient"),
                "areaM2": payload.get("areaM2"),
                "massKg": payload.get("massKg"),
            }
            if any(item is not None for item in flat_options.values()):
                payload["propagationOptions"] = flat_options
        if not any(key in payload for key in ("object_metadata", "objectMetadata")):
            flat_metadata = {
                "objectType": payload.get("objectType"),
                "missionType": payload.get("missionType"),
                "operator": payload.get("operator"),
                "country": payload.get("country"),
                "launchDate": payload.get("launchDate"),
            }
            if any(item is not None for item in flat_metadata.values()):
                payload["objectMetadata"] = flat_metadata
        return payload

    @field_validator("name")
    @classmethod
    def validate_name(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("El nombre de la órbita no puede estar vacío")
        if "\n" in cleaned or "\r" in cleaned:
            raise ValueError("El nombre de la órbita no puede contener saltos de línea")
        return cleaned

    @field_validator("epoch", "start_time", "end_time")
    @classmethod
    def normalize_utc(cls, value: datetime.datetime | None) -> datetime.datetime | None:
        if value is None:
            return None
        return ensure_utc(value)

    @field_validator("propagator")
    @classmethod
    def normalize_propagator(cls, value: str) -> str:
        return normalize_manual_orbit_propagator(value)

    @field_validator("definition_source", mode="before")
    @classmethod
    def normalize_definition_source(cls, value):
        if value is None:
            return None
        normalized = str(value).strip().replace("-", "_")
        if normalized.lower() == "statevector":
            return "state_vector"
        return normalized.lower()

    @model_validator(mode="after")
    def validate_definition_and_range(self):
        if self.keplerian is None and self.state_vector is None:
            raise ValueError("Debes enviar keplerian o state_vector")
        if self.definition_source == "keplerian" and self.keplerian is None:
            raise ValueError("definition_source keplerian requiere elementos keplerianos")
        if self.definition_source == "state_vector" and self.state_vector is None:
            raise ValueError("definition_source state_vector requiere un vector de estado")
        if self.end_time is not None and self.start_time is not None and self.end_time <= self.start_time:
            raise ValueError("end_time debe ser mayor que start_time")
        # Keep historical synthetic-SGP4 records readable. They are rejected
        # by the runtime/API boundary with a specific explanation instead of
        # being silently converted into a different manual model.
        if self.propagator == "sgp4":
            return self
        if self.propagation_options.atmospheric_drag and self.propagator != "cowell-rk4":
            raise ValueError(
                "atmospheric_drag is only available with the Cowell/RK4 propagator; "
                "select cowell-rk4 and a force model"
            )
        return self

    @model_validator(mode="after")
    def project_fixed_engine_force_terms(self):
        """Make the request model describe the engine that will run.

        Stale non-drag Cowell controls can accompany older project records.
        They stay accepted for compatibility, but fixed engines must expose
        their immutable composition rather than terms they do not execute.
        Explicit drag is intentionally rejected before this projection.
        """

        if self.propagator == "sgp4":
            # This is an unavailable legacy record. Preserve its raw options
            # long enough for callers to identify it; the runtime rejects it
            # before any force composition or propagation is applied.
            return self
        resolved_options = self.propagation_options.canonical(propagator=self.propagator)
        if self.propagator != "cowell-rk4":
            self.propagation_options.force_terms = tuple(resolved_options["force_terms"])
            self.propagation_options.atmospheric_drag = False
        return self


# The inspector is intended for a readable table/chart, not an unbounded OEM
# export.  Keep its sampling budget explicit and independent from the much
# larger renderer ephemeris ceiling.
ORBIT_PARAMETERS_MAX_SAMPLES = 2_000


class OrbitParametersSource(BaseModel):
    """One unambiguous source for propagated orbital-parameter samples.

    A catalogue/TLE source intentionally remains SGP4/TEME at the inspector
    boundary.  A manual source reuses :class:`ManualOrbitRequest`, which
    preserves the selected native model (including J2/J3/J4 and drag) rather
    than silently changing it into a different propagation model.
    """

    model_config = ConfigDict(populate_by_name=True)

    kind: Literal["catalog", "manual"] = Field(
        validation_alias=AliasChoices("kind", "type", "source_type", "sourceType"),
    )
    sat_id: str | None = Field(
        default=None,
        validation_alias=AliasChoices("sat_id", "satId", "satelliteId", "id"),
    )
    line1: str | None = Field(
        default=None,
        validation_alias=AliasChoices("line1", "tle_line1", "tleLine1"),
    )
    line2: str | None = Field(
        default=None,
        validation_alias=AliasChoices("line2", "tle_line2", "tleLine2"),
    )
    manual_orbit: ManualOrbitRequest | None = Field(
        default=None,
        validation_alias=AliasChoices("manual_orbit", "manualOrbit", "orbit"),
    )

    @model_validator(mode="before")
    @classmethod
    def normalize_manual_source_shape(cls, value):
        """Accept ``source: { ...manual fields }`` as a compact convenience.

        The documented form nests the definition under ``manualOrbit``.  The
        fallback makes the endpoint ergonomic for callers that already hold a
        manual-editor payload and prevents a vague missing-field error.
        """

        if not isinstance(value, dict):
            return value
        payload = dict(value)
        nested_tle = payload.get("tle")
        if isinstance(nested_tle, dict):
            payload.setdefault("line1", nested_tle.get("line1", nested_tle.get("tleLine1")))
            payload.setdefault("line2", nested_tle.get("line2", nested_tle.get("tleLine2")))
        raw_kind = payload.get("kind", payload.get("type", payload.get("sourceType")))
        if isinstance(raw_kind, str) and raw_kind.strip().lower() in {"manual", "manual-orbit"}:
            payload["kind"] = "manual"
            if not any(key in payload for key in ("manual_orbit", "manualOrbit", "orbit")):
                manual_keys = {
                    "name", "epoch", "epochUtc", "epoch_utc", "propagator",
                    "objectMetadata", "object_metadata", "propagationOptions", "propagation_options",
                    "manualErp", "manual_erp", "manualErpSnapshotId", "manual_erp_snapshot_id",
                    "definitionSource", "definition_source", "source", "keplerian", "stateVector", "state_vector",
                }
                compact_manual = {key: item for key, item in payload.items() if key in manual_keys}
                if compact_manual:
                    payload["manualOrbit"] = compact_manual
        return payload

    @field_validator("kind", mode="before")
    @classmethod
    def normalize_kind(cls, value: object) -> str:
        normalized = str(value or "").strip().lower().replace("_", "-")
        if normalized in {"catalog", "tle", "catalog-tle"}:
            return "catalog"
        if normalized in {"manual", "manual-orbit", "manualorbit"}:
            return "manual"
        return normalized

    @model_validator(mode="after")
    def validate_source(self):
        has_satellite = bool(self.sat_id and self.sat_id.strip())
        has_tle = bool(self.line1 and self.line1.strip() and self.line2 and self.line2.strip())
        has_partial_tle = bool(self.line1 and self.line1.strip()) != bool(self.line2 and self.line2.strip())
        if self.kind == "manual":
            if self.manual_orbit is None:
                raise ValueError("Una fuente manual requiere manual_orbit")
            if has_satellite or has_tle or has_partial_tle:
                raise ValueError("Una fuente manual no puede incluir sat_id ni líneas TLE")
        else:
            if self.manual_orbit is not None:
                raise ValueError("Una fuente de catálogo no puede incluir manual_orbit")
            if has_partial_tle:
                raise ValueError("Debes enviar ambas líneas TLE")
            if has_satellite and has_tle:
                raise ValueError("Envía sat_id o line1+line2, no ambos")
            if not has_satellite and not has_tle:
                raise ValueError("Una fuente de catálogo requiere sat_id o line1+line2")
        return self


class OrbitParametersRequest(BaseModel):
    """Validated range and source for the orbital-parameter inspector."""

    model_config = ConfigDict(populate_by_name=True)

    source: OrbitParametersSource
    start_time: datetime.datetime = Field(
        validation_alias=AliasChoices("start_time", "startTime"),
    )
    end_time: datetime.datetime = Field(
        validation_alias=AliasChoices("end_time", "endTime"),
    )
    samples: int = Field(
        default=121,
        validation_alias=AliasChoices("samples", "sample_count", "sampleCount"),
        ge=2,
        le=ORBIT_PARAMETERS_MAX_SAMPLES,
    )

    @model_validator(mode="before")
    @classmethod
    def accept_direct_source_fields(cls, value):
        """Wrap legacy/direct source fields into the explicit ``source`` node."""

        if not isinstance(value, dict):
            return value
        payload = dict(value)
        if payload.get("source") is not None:
            return payload
        manual = payload.get("manual_orbit", payload.get("manualOrbit"))
        if manual is not None:
            payload["source"] = {"kind": "manual", "manualOrbit": manual}
            return payload
        sat_id = payload.get("sat_id", payload.get("satId", payload.get("satelliteId")))
        line1 = payload.get("line1", payload.get("tleLine1", payload.get("tle_line1")))
        line2 = payload.get("line2", payload.get("tleLine2", payload.get("tle_line2")))
        if sat_id is not None or line1 is not None or line2 is not None:
            payload["source"] = {
                "kind": "catalog",
                "satId": sat_id,
                "line1": line1,
                "line2": line2,
            }
        return payload

    @field_validator("start_time", "end_time")
    @classmethod
    def normalize_inspector_utc(cls, value: datetime.datetime) -> datetime.datetime:
        return ensure_utc(value)

    @model_validator(mode="after")
    def validate_range(self):
        duration_seconds = (self.end_time - self.start_time).total_seconds()
        if duration_seconds <= 0:
            raise ValueError("end_time debe ser mayor que start_time")
        if duration_seconds > PROPAGATION_HOURS_MAX * 3600.0:
            raise ValueError(
                f"El intervalo no puede superar {PROPAGATION_HOURS_MAX:g} horas"
            )
        return self


class AosLosRequest(BaseModel):
    """A station-access request for either a catalogue or manual orbit.

    The original AOS/LOS API accepted sat_id or explicit TLE lines at the
    top level. Keep that shape readable while using the same explicit source
    contract as the orbital-parameter inspector for manually authored
    states. A manual source contains a complete ManualOrbitRequest; its
    native EME2000 dynamics are transformed to ITRF before station geometry
    is evaluated.
    """

    model_config = ConfigDict(populate_by_name=True)

    source: OrbitParametersSource | None = None
    # Legacy catalogue fields remain public so direct Python callers and old
    # HTTP clients can keep constructing the request exactly as before. The
    # pre-validator below projects them into source.
    sat_id: str | None = Field(
        default=None,
        validation_alias=AliasChoices("sat_id", "satId", "satelliteId", "id"),
    )
    line1: str | None = Field(
        default=None,
        validation_alias=AliasChoices("line1", "tle_line1", "tleLine1"),
    )
    line2: str | None = Field(
        default=None,
        validation_alias=AliasChoices("line2", "tle_line2", "tleLine2"),
    )
    station: StationInput
    start_time: datetime.datetime = Field(
        validation_alias=AliasChoices("start_time", "startTime"),
    )
    end_time: datetime.datetime = Field(
        validation_alias=AliasChoices("end_time", "endTime"),
    )
    step_seconds: float = Field(
        default=10.0,
        validation_alias=AliasChoices("step_seconds", "stepSeconds"),
        gt=0,
        le=600,
    )
    # Pass extraction always evaluates the full internal sample sequence.
    # Realtime telemetry consumers can omit that potentially large sequence
    # from the HTTP response once they only need the AOS/LOS windows.
    include_samples: bool = Field(
        default=True,
        validation_alias=AliasChoices("include_samples", "includeSamples"),
    )
    # None preserves the historical full-window chart response. A caller
    # that only plots individual contacts can instead request the samples
    # surrounding each refined AOS/LOS interval.
    chart_padding_seconds: float | None = Field(
        default=None,
        validation_alias=AliasChoices("chart_padding_seconds", "chartPaddingSeconds"),
        ge=0,
        le=3_600,
    )

    @model_validator(mode="before")
    @classmethod
    def accept_legacy_catalogue_source(cls, value):
        """Wrap the historical flat catalogue source in source.

        The manual form is deliberately not inferred from arbitrary orbital
        fields at the top level: callers must explicitly declare a manual
        source so a state vector can never accidentally be interpreted as a
        TLE request.
        """

        if not isinstance(value, dict):
            return value
        payload = dict(value)
        if payload.get("source") is not None:
            return payload

        manual = payload.get("manual_orbit", payload.get("manualOrbit"))
        if manual is not None:
            payload["source"] = {"kind": "manual", "manualOrbit": manual}
            return payload

        sat_id = payload.get("sat_id", payload.get("satId", payload.get("satelliteId")))
        line1 = payload.get("line1", payload.get("tleLine1", payload.get("tle_line1")))
        line2 = payload.get("line2", payload.get("tleLine2", payload.get("tle_line2")))
        if sat_id is not None or line1 is not None or line2 is not None:
            payload["source"] = {
                "kind": "catalog",
                "satId": sat_id,
                "line1": line1,
                "line2": line2,
            }
        return payload

    @field_validator("start_time", "end_time")
    @classmethod
    def normalize_access_utc(cls, value: datetime.datetime) -> datetime.datetime:
        return ensure_utc(value)

    @model_validator(mode="after")
    def validate_access_source_and_range(self):
        if self.source is None:
            raise ValueError("Debes enviar source o sat_id o line1+line2")
        if self.source.kind == "manual" and any(
            value is not None and str(value).strip()
            for value in (self.sat_id, self.line1, self.line2)
        ):
            raise ValueError("Una fuente manual no puede incluir sat_id ni lÃ­neas TLE")
        if self.end_time <= self.start_time:
            raise ValueError("end_time debe ser mayor que start_time")
        return self
