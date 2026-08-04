# Performance

[Home](../index.md) · [Operation](index.md) · [Settings](configuration.md) · [Display](../user-guide/visualization.md) · [Layers](../user-guide/layers.md)

The cost of Orbit depends on the number of visible layers, the frequency of
update, of the propagation horizon, of the temporal range density
and the browser's graphic load. No single benchmark is published: the
Result depends on catalog, GPU, basemap, resolution and browser.

## Highest impact controls

| Control | Operational effect | Commitment |
| --- | --- | --- |
| Visible layers | Fewer entities and traces to update and draw | Less simultaneous context in the viewer. |
| Propagation horizon | Reduce or expand the requested visual paths | A short horizon shows less future. |
| Real time intervals | Adjust status and orbit cadence | Shorter intervals increase networking, computing, and rendering. |
| Antialiasing | Off, FXAA or MSAA | MSAA and FXAA prioritize edges; off allows adaptive reduction in small viewports. |
| Basemap | Local or remote | A remote map depends on the network and its provider. |
| Simulation range and export step | Defines the number of samples requested | Long ranges or small steps produce more samples. |

The values are changed from the panel documented in
[Settings](configuration.md).

## Adaptive scaling

The runtime calculates an adaptive interface scale from the viewport. The
Resolution scaling may also be reduced in small viewports when the
antialiasing is disabled. If FXAA or MSAA is selected, the runtime
maintains full resolution to avoid degrading fine orbital lines.

The policy is not a substitute for validation on the target hardware. Try the
real catalog, projection and resolution of the operating position.

## Best Practices

1. Hide layers that are not involved in the current inspection using
   [Layers](../user-guide/layers.md).
2. Use a propagation horizon consistent with the visual window, not a
   need for an ephemeris file.
3. For screenshots or presentations, set the time to Static or pause Real time
   before recording.
4. Prefer Natural Earth or Local Earth 2 km when the environment does not guarantee
   connectivity to a remote map.
5. Use ephemeris export for data, not a screen recording.
6. Reduce ranks and increase pace before requesting an extensive ephemeris
   during an interactive operation.

## Earth Tiles 2 km

Orbit can serve local XYZ tiles generated from the Earth 2 asset
km. From server:

~~~powershell
npm run tiles:earth2km
~~~

The command generates zoom tiles 0 to 6 by default under
front/assets/earth2km_tiles/. Increasing the maximum zoom increases space
disk and generation time; it does not change the precision of the orbital data.

## Diagnosis

- Use ./.scripts/orbit-status.cmd to check the healthcheck of the
  container.
- Use ./.scripts/orbit-logs.cmd to track gateway or backend errors.
- Check WebGL, graphics driver and map loading first if the
  problem is limited to the viewer.
- If the problem affects ground accuracy, validate snapshots, hashes and
  coverage following [Time and EOP](time-eop.md).

!!! note "Scientific limit"

    Reducing resolution, hiding layers, or changing antialiasing only changes the
    presentation and cost of execution. It does not compensate for an expired TLE, a
    incomplete OEM source nor the absence of local EOP for an accurate calculation.