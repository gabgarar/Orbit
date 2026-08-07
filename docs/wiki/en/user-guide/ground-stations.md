# Ground stations

[Home](../index.md) · [User Guide](index.md) · [Layers](layers.md) · [Timeline](timeline.md) · [Export](export.md)

A ground station is a workspace layer with position,
simplified elevation mask and presentation and radius attributes. The
Stations are saved within the project document.

## Configurable parameters

| Group | Fields |
| --- | --- |
| General | Name, latitude, longitude, altitude, elevation mask and coverage radius. |
| Time | Station IANA time zone, for example `Europe/Madrid` or `UTC`. |
| Radio | Frequency, transmit power, transmit gain and receive gain. |
| Visual | Symbol size and color. |
| Coverage | RF coverage-envelope visibility. |

Interface coordinates are entered in degrees for latitude and longitude and
in meters for altitude. The elevation mask determines the threshold used
to classify a sample as visible.

## Visibility and passes

The operational entry point is **Ground Stations** in the top toolbar. The
panel selects a station and an orbital layer and calculates passes for the next
24 hours from the active epoch. It always uses the elevation mask configured
when the station was created or edited; there is no second temporary mask in
the analysis. Results show
AOS, LOS, and peak elevation; they enable the layer ground track and draw a
green station-to-satellite link while the satellite is above the mask. Station
geometry and visibility states are evaluated in ITRF/WGS-84. Green AOS/LOS
markers appear on the simulated timeline and the pass table can be exported as
CSV. The elevation profile uses the calculated 30 s samples: blue is the full
trajectory and green is only the segment above the station mask. It does not
yet model twilight, Sun, Moon, or astronomical constraints.

Each monitored station–satellite pair automatically draws a green line in the
scene while its instantaneous elevation is above that station's mask. The line
vanishes when visibility is lost and is not drawn for layers the station does
not monitor. The pass chart time axis uses the station IANA time zone and keeps
the UTC offset in every label.

The operational pass calculation currently supports TLE/SGP4 layers. OEM, SP3,
and manual designs retain their visualization, but need a general access
ephemeris provider before this panel can schedule their passes.

## Monitoring

When a station is created, Orbit asks which TLE/SGP4 layers it should monitor.
The assignment can be changed through **Monitored satellites** in the station
panel. Activating a new satellite layer opens the inverse flow for selecting
the stations that will track it. Each station details card exposes
**AOS / LOS tables** as a direct pass-analysis entry point.

Orbit calculates elevation of the propagated states and returns samples with a
visibility mark. AOS/LOS intervals are extracted when crossing the threshold of
the mask during the ephemeris sampling.

~~~mermaid
flowchart LR
    S[Estado propagado] --> E[Elevación en la estación]
    E --> M{Máscara de elevación}
    M -->|superada| V[Muestra visible]
    M -->|no superada| N[Muestra no visible]
    V --> P[Extracción de pases]
    N --> P
~~~

!!! warning "Resolution of OSA and LOS"

    Pass detection is achieved by step sampling. Does not use
    High-precision root search for the crossing instant. Reduce the
    sampling step in the flow that builds the ephemeris if a
    higher resolution and validate the result with appropriate tools to
    mission.

### Visibility equations implemented

Orbit converts WGS-84 geodetic station to ITRF. With semi-major axis \(a\), square eccentricity \(e^2\), latitude \(\varphi\), longitude \(\lambda\) and height \(h\):

$$
N(\varphi)=\frac{a}{\sqrt{1-e^2\sin^2\varphi}},
$$

$$
\mathbf r_{\mathrm{est}}=
\begin{bmatrix}
(N+h)\cos\varphi\cos\lambda\\
(N+h)\cos\varphi\sin\lambda\\
\left[N(1-e^2)+h\right]\sin\varphi
\end{bmatrix}.
$$

For \(\Delta\mathbf r=\mathbf r_{\mathrm{sat,ITRF}}-\mathbf r_{\mathrm{est}}\), the local components that the service calculates are:

$$
\begin{aligned}
E&=-\sin\lambda\,\Delta x+\cos\lambda\,\Delta y,\\
N&=-\sin\varphi\cos\lambda\,\Delta x-\sin\varphi\sin\lambda\,\Delta y+\cos\varphi\,\Delta z,\\
U&=\cos\varphi\cos\lambda\,\Delta x+\cos\varphi\sin\lambda\,\Delta y+\sin\varphi\,\Delta z.
\end{aligned}
$$

The elevation and visibility rating are:

$$
\epsilon=\operatorname{atan2}\left(U,\sqrt{E^2+N^2}\right),
\qquad
\mathrm{visible}\iff\epsilon\ge\epsilon_{\min}.
$$

AOS and LOS are extracted from the first and last sample that meet that threshold; the instant of crossing is not refined.

### Variables, units and Orbit use

\(a\), \(N\), \(h\), \(E\), \(N\), \(U\), \(\Delta\mathbf r\), and ITRF positions are expressed in metres; \(e^2\) is dimensionless and \(\varphi\), \(\lambda\), \(\epsilon\), and \(\epsilon_{\min}\) are converted to radians during calculation. The UI accepts latitude/longitude in degrees and altitude or mask in metres/degrees, but `ground_stations.visibility` normalises them before evaluating ENU and the threshold. AOS/LOS are derived from discrete samples, not a continuous root.

## Coverage and radio

The RF coverage envelope is a visual representation associated with the
layer. Radio fields allow for a simplified link budget, not
a complete RF chain model. There is no published modeling of antennas,
atmospheric propagation, interference, availability, network planning
nor measures received.

## Use in a project

1. Create or edit the station from the workspace.
2. Enter your parameters and save changes.
3. Activate station visibility and the RF coverage envelope when needed.
4. Select a time or time range before checking visibility.
5. Save or export the [Project](projects.md) to keep the station.

Stations are not catalog objects and are not exported as a standard
station external from the anniversaries dialog. Currently preserved
in the project JSON.
