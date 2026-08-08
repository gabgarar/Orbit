# Ground stations

[Home](../index.md) · [User Guide](index.md) · [Layers](layers.md) · [Timeline](timeline.md) · [Export](export.md)

A ground station is a workspace layer that combines its WGS-84 position with a deterministic RF model. The same station contract drives the designer, scene coverage, instantaneous telemetry, and AOS/LOS, but each consumer declares its purpose: the renderer caps drawn range to keep the scene responsive and the service receives an explicit operational range gate. The drawn footprint alone is not an access criterion.

## Overview

Orbit distinguishes two results that must not be confused:

- The **reciprocal planning envelope** estimates the distance at which a terminal equivalent to the station could close a link. It is useful for design and visualisation; it does not claim that an arbitrary satellite will receive or transmit correctly.
- A **real satellite link** requires a complete remote RF profile: EIRP effective toward the station, a compatible frequency or channel, polarisation, and bandwidth. Orbit verifies that the signal can be tuned inside the receive band before it calculates received power or SNR. If a layer does not publish those data, it presents the planning budget and marks SNR as unavailable. It does not invent link quality.

Geometry and line of sight are evaluated in ITRF/WGS-84. UTC is the physical time scale and the time representation transported by the API. The station IANA time zone —for example `Europe/Madrid`— only formats table and chart labels in local time, including daylight-saving transitions; it does not alter the physical calculation or the UTC timestamps exported in CSV.

## Create or edit a station

The designer lets you change parameters and review derived values before adding the layer to the project. The station details card retains the same RF contract and shows its calculated metrics.

### Geometry and context

| Field | Unit or values | Orbit use |
| --- | --- | --- |
| Name | Text | Identifies the layer and pass tables. |
| Latitude, longitude, altitude | degrees, degrees, m | WGS-84 position converted to ITRF to obtain local look angles. |
| Time zone | IANA name, for example Europe/Madrid | Formats axes and local times. |
| Elevation mask | degrees | Operational horizon limit. |

### Antenna and radiation pattern

| Field | Unit or values | Orbit use |
| --- | --- | --- |
| Dish diameter | m | Calculates circular-aperture gain and beamwidth. |
| Efficiency | 0–1 | Scales the dish-derived gain. |
| Frequency | MHz or Hz | Determines wavelength, free-space loss, and beam size. |
| Polarisation | RHCP, LHCP, or linear | Used with a complete remote profile to calculate mismatch loss. |
| Pattern | Gaussian or cos^n | Defines gain falloff away from boresight. |
| Azimuth/elevation HPBW | degrees, optional | Lets the user impose a known beamwidth; it does not turn the simplified pattern into a measurement. |
| Side-lobe level | dB below the main lobe | Sets a conservative floor; Orbit does not invent lobe positions. |

For a circular dish, Orbit uses:

$$
G_{\max}=10\log_{10}\left[\eta\left(\frac{\pi D}{\lambda}\right)^2\right],
\qquad
\lambda=\frac{c}{f}.
$$

Derived HPBW is:

$$
\operatorname{HPBW}\approx70\frac{\lambda}{D}\quad[\mathrm{deg}].
$$

\(D\) is diameter in m, \(\eta\) is dimensionless efficiency, \(\lambda\) is wavelength in m, \(c\) is the speed of light in m/s, and \(f\) is frequency in Hz. \(G_{\max}\) is expressed in dBi. HPBW is full half-power width: a one-dimensional HPBW/2 offset corresponds to a 3 dB loss.

Orbit evaluates a **continuous** pattern in every direction, not a binary region. For offsets from boresight, it defines:

$$
q=\sqrt{\left(\frac{\Delta A}{\operatorname{HPBW}_{A}/2}\right)^2+
\left(\frac{\Delta E}{\operatorname{HPBW}_{E}/2}\right)^2}.
$$

For the Gaussian pattern, the relative loss is:

$$
\Delta G=\max\left(-3q^2,-L_{\mathrm{SLL}}\right)\quad[\mathrm{dB}].
$$

The `cos^n` pattern calibrates its exponent so that the HPBW half-width also produces −3 dB. \(\Delta A\) and \(\Delta E\) are azimuth and elevation errors in degrees; \(L_{\mathrm{SLL}}\) is the configured side-lobe level in dB below the peak. The side-lobe floor limits gain decay, but Orbit does not invent measured lobe locations. Consequently, the HPBW contour is a −3 dB diagnostic, never a hard access cutoff.

### Power, noise, and losses

| Field | Unit | Orbit use |
| --- | --- | --- |
| TX power | dBm or W | Normalised to dBm for the budget. |
| TX/RX gain | dBi, calculated or overridden | An override replaces the dish-derived gain for that port. |
| Minimum RX power | dBm | Receive threshold for the envelope and an available link. |
| System temperature | K | Determines receiver thermal noise. |
| Receiver bandwidth | Hz | Determines thermal noise and SNR calculation. |
| Atmospheric, rain, cable, and connector losses | dB | Added as independent losses. |
| RMS pointing accuracy | millidegrees | Reduces effective gain according to HPBW. |
| Required SNR | dB | Additional threshold only when a complete, compatible remote RF profile exists. |

The noise floor and figure of merit are calculated as:

$$
N=-198.6+10\log_{10}(T_{\mathrm{sys}})+10\log_{10}(B)\quad[\mathrm{dBm}],
$$

$$
\frac{G}{T}=G_{\mathrm{RX,eff}}-L_{\mathrm{hardware}}-10\log_{10}(T_{\mathrm{sys}})
\quad[\mathrm{dB/K}].
$$

\(T_{\mathrm{sys}}\) is entered in K, \(B\) in Hz, \(G_{\mathrm{RX,eff}}\) in dBi, and \(L_{\mathrm{hardware}}\) in dB. Cable and connector losses belong to the hardware term; atmospheric and rain losses apply to the path. Pointing loss is calculated from RMS error and HPBW, and reduces effective gains.

### Pointing and mechanical limits

| Field | Values | Effect |
| --- | --- | --- |
| Mode | tracking, scan, or stationary | Defines how the beam is interpreted against a target. |
| Boresight | azimuth and elevation, degrees | Fixed direction used by stationary mode. |
| Mechanical limits | azimuth and elevation, degrees | The target must be reachable by the mount. |

In **tracking**, the station points its beam at the target within mechanical limits; the budget evaluates that target at pointing gain. In **scan**, Orbit represents the mechanical field of regard as **potential coverage**: a reachable target may be considered during planning, but no schedule, scan rate, dwell time, or scan law yet guarantees that the antenna is following it at that instant. In **stationary**, boresight remains fixed and the continuous pattern gain is applied in the observed direction. HPBW marks the −3 dB contour, not a binary wall: once mask and mechanical limits pass, the directional pattern and link threshold determine whether the target is operational.

!!! warning "Meaning of scan mode"

    Until Orbit implements a tracking schedule or scan law, an AOS/LOS result in `scan` mode is potential geometric and RF access inside the mount field. It does not confirm resource allocation, acquisition, or usable contact time.

## Link model and envelope

Free-space path loss is:

$$
L_{\mathrm{FS}}=32.44+20\log_{10}(f_{\mathrm{MHz}})+20\log_{10}(R_{\mathrm{km}})
\quad[\mathrm{dB}].
$$

For a reference terminal, planning power is:

$$
P_{\mathrm{RX}}=P_{\mathrm{TX}}+G_{\mathrm{TX}}(\theta,\phi)+G_{\mathrm{RX,ref}}
-L_{\mathrm{FS}}-L_{\mathrm{prop}}-L_{\mathrm{hardware}}.
$$

Orbit solves for maximum distance when \(P_{\mathrm{RX}}\ge P_{\mathrm{RX,min}}\). Here \(f\) is in MHz, \(R\) in km, \(P\) in dBm, and gains and losses are in dB/dBi. \(G_{\mathrm{TX}}(\theta,\phi)\) is the Gaussian or cos^n pattern with configured pointing reduction and side-lobe floor.

When a satellite layer publishes a complete remote RF profile, Orbit calculates the downlink instead of reusing this reciprocal envelope:

$$
P_{\mathrm{RX,actual}}=\operatorname{EIRP}_{\mathrm{remote}}+G_{\mathrm{RX}}(\theta,\phi)
-L_{\mathrm{FS}}-L_{\mathrm{prop}}-L_{\mathrm{hardware}}-L_{\mathrm{pol}},
$$

$$
\operatorname{SNR}=P_{\mathrm{RX,actual}}-N.
$$

In addition to EIRP, polarisation, and remote bandwidth, the **entire occupied signal** must fit inside the station's centred receive bandwidth:

$$
|f_{\mathrm{remote}}-f_{\mathrm{station}}|+\frac{B_{\mathrm{remote}}}{2}
\le\frac{B_{\mathrm{RX}}}{2}.
$$

This prevents accepting a centred carrier whose occupied spectrum is clipped by the receiver filter. If the condition fails, Orbit leaves actual received power and SNR unavailable; it does not approximate a link from incompatible data.

!!! info "Interpretation limit"

    The envelope is not an availability map or a link prediction for an arbitrary TLE, OMM, OEM, or SP3 layer. Without remote-terminal effective EIRP, a compatible frequency or channel, polarisation, and bandwidth, Orbit cannot know actual received power or SNR. The result is explicitly labelled as a reciprocal planning envelope.

The scene obtains a 2D footprint and a 3D coverage volume from this model. In 2D, the footprint is a geodesic projection of the field of regard: azimuth stops create sectors and an elevation ceiling below 90° can create an annular sector. It is a visual aid, not a terrain line-of-sight map or the AOS/LOS condition. In 3D, stationary mode builds a directional mesh over the complete mechanically reachable field: the range in every direction follows the free-space range law and the configured continuous pattern. Tracking and scan show the potential mechanical field because neither has one fixed pointing direction.

Drawn range is capped to keep the scene responsive, while calculated physical range remains available in the metrics. The AOS/LOS request uses an explicit operational range gate; it must not be inferred from the appearance or size of the footprint. The **Pattern** tab provides 2D sections and a discrete \(G(\theta,\phi)\) sample to inspect relative gain. After analysing a satellite that publishes a complete RF profile, it also shows an angular \(P_{\mathrm{RX}}\) and SNR-margin sample at the instantaneous range: the sample is around boresight, not an availability heat map over Earth. The mesh and curves are derived from entered parameters, not presented as a measured antenna pattern.

## Visibility, AOS, and LOS

**Ground Stations** lets you freely select a station and an orbital source already present in Layers. It can be a catalogue TLE/SGP4 layer or a confirmed manual orbit. A permanent satellite-to-station association is not required. OEM and SP3 layers retain their visualisation, but do not yet have a general access provider for pass planning. The table lists AOS, LOS, and maximum elevation for the selected window; it can be exported as CSV. Response and CSV timestamps remain UTC; the table and chart render them in the station IANA time zone.

### Manual source for pass tables

A manual orbit is analysed from its own authored definition: epoch, elements or state vector, selected propagator, and propagation options. For example, a `two-body` definition retains its analytical dynamics and a `cowell-rk4` definition retains its force terms and RK4; the table neither converts it into a TLE nor propagates it with SGP4.

Station geometry follows one contract. Orbit first propagates the manual state in its native `EME2000` dynamics frame and transforms **only the position** of every sample to `ITRF`; it then calculates ENU, azimuth, elevation, and range relative to the WGS-84 station. The response therefore publishes `reference_frame: ITRF` and `time_scale: UTC`, even when the original source is manual.

In the interface, a manual orbit's table uses the stored UTC design/propagation interval (`startTime` through `endTime`) as a fixed range. This ensures that the table and chart never leave the ephemeris confirmed by the operator. To analyse another interval, edit and propagate the manual orbit again. The REST contract retains explicit `start_time` and `end_time` for integrations that deliberately need to request another window.

A manual query does not register a satellite in the catalogue, create a NORAD/COSPAR identifier, or modify the manual layer. Its authored name is used only as the response `satellite` label, and provenance returns `source.kind: manual`, the canonical propagator, and `dynamics_reference_frame: EME2000`. Manual queries use **POST**; `GET /api/aos-los` remains reserved for a catalogue identifier.

Every view applies the same operational condition:

1. Elevation exceeds the mask.
2. Azimuth and elevation are inside mechanical limits.
3. In stationary mode, the fixed-boresight pattern applies directional gain.
4. The planning budget reaches the receive threshold with that gain.

A green station-to-satellite line is drawn only while those conditions hold. The elevation chart uses one curve: its operational segment changes colour and AOS/LOS are marked with vertical lines. Timeline markers correspond to the same calculated intervals.

### Implemented geometry

Orbit converts a WGS-84 geodetic station to ITRF. With semi-major axis \(a\), squared eccentricity \(e^2\), latitude \(\varphi\), longitude \(\lambda\), and height \(h\):

$$
N(\varphi)=\frac{a}{\sqrt{1-e^2\sin^2\varphi}},
$$

$$
\mathbf r_{\mathrm{station}}=
\begin{bmatrix}
(N+h)\cos\varphi\cos\lambda\\
(N+h)\cos\varphi\sin\lambda\\
\left[N(1-e^2)+h\right]\sin\varphi
\end{bmatrix}.
$$

For \(\Delta\mathbf r=\mathbf r_{\mathrm{sat,ITRF}}-\mathbf r_{\mathrm{station}}\), ENU components are:

$$
\begin{aligned}
E&=-\sin\lambda\,\Delta x+\cos\lambda\,\Delta y,\\
N&=-\sin\varphi\cos\lambda\,\Delta x-\sin\varphi\sin\lambda\,\Delta y+\cos\varphi\,\Delta z,\\
U&=\cos\varphi\cos\lambda\,\Delta x+\cos\varphi\sin\lambda\,\Delta y+\sin\varphi\,\Delta z.
\end{aligned}
$$

$$
\epsilon=\operatorname{atan2}\left(U,\sqrt{E^2+N^2}\right).
$$

Positions and ENU components are expressed in metres. \(\varphi\), \(\lambda\), and \(\epsilon\) are computed in radians, although the interface accepts and displays degrees. The base ephemeris is sampled at the requested step. When two adjacent samples change operational state, Orbit evaluates the same propagator and ITRF geometry again by bisection to bracket AOS or LOS to approximately 0.5 s. The published maximum elevation remains the maximum among profile samples, not a continuously optimised maximum.

The expanded **AOS/LOS tables** analysis scans the profile at 20 s and refines every AOS/LOS crossing to approximately 0.5 s. This keeps multiple vertices for an ordinary LEO contact without blocking the interface with an unnecessary 24-hour series. The chart receives only the neighbourhood of each pass, with 120 s before and after it. A station's next-pass cards use an even lighter 30 s discovery request, do not download the complete elevation series, and run only a small number of requests concurrently. That is a UI forecast; an operational decision should open the table. As with any discrete sampling, a complete contact shorter than the step may not be bracketed; reduce the step through the API when that detection level is required.

!!! warning "Pass resolution"

    Refinement only improves a transition already bracketed by two samples. An excessively large step can miss a short pass entirely or misrepresent peak elevation. A smaller step improves profile fidelity and window detection, but does not make the result an operations-certified prediction. Orbit does not yet model local obstruction, refraction, time-varying rain, interference, availability, antenna scheduling, or acquisition.

## Use in a project

1. Create a station and complete geometry, antenna, RF, and pointing data.
2. Review derived metrics before selecting **Add to Layers**.
3. In **Ground Stations**, select any available station and a catalogue TLE/SGP4 layer or a confirmed manual orbit to open AOS/LOS tables. A manual orbit uses its designed UTC interval; edit and propagate it again before changing that window.
4. Enable coverage when you want to inspect the planning footprint or volume.
5. Save the [Project](projects.md) to retain the complete RF contract.

## Importing and exporting stations

Select **Import** to add a GeoJSON, Orbit JSON, or CSV file to the open
project. Import validates each record, adds valid ones, and reports skipped
ones. It does not restore a simulation or replace the current project.

Select **Export** in a station action to choose GeoJSON, Orbit JSON, or CSV;
project actions can do the same for every station. GeoJSON is recommended for
QGIS and other GIS workflows. Orbit JSON is the native station copy for
importing back into Orbit. CSV supports tabular editing and contains no
calculated results.

All three formats retain position and authored configuration, but not range,
mesh, AOS/LOS, SNR, pass results, or viewer entities. Use [Project JSON](projects.md)
when you need to restore the complete workspace. See [Ground-station interchange](../formats/ground-stations/interchange.md)
for the schema, RF fields, QGIS workflow, and interoperability limits.
