# Ground-station formats

[Home](../../index.md) · [Formats](../index.md) · [Ground stations](../../user-guide/ground-stations.md)

## Overview

A station is a project layer with a WGS-84 position and authored RF
configuration. It can be persisted inside a complete project or exchanged
independently without becoming a catalogue object.

| Route | Status | Use |
| --- | --- | --- |
| [Project JSON](project-json.md) | Available. | Complete-workspace persistence. |
| [Station interchange](interchange.md) | Import and export available. | GeoJSON, Orbit JSON, and CSV for independent stations. |
| [RINEX](../rinex.md) | Unavailable. | Does not create stations or GNSS observations. |
