#!/usr/bin/env python3
"""
Genera teselas XYZ WebMercator a partir de una textura equirectangular global (2:1).
Entrada esperada: earth2km.jpg en EPSG:4326 estilo lat/lon global.
Salida: public/assets/earth2km_tiles/{z}/{x}/{y}.jpg

Uso:
  python3 server/python/generate_earth2km_tiles.py \
    --input public/assets/earth2km.jpg \
    --output public/assets/earth2km_tiles \
    --min-zoom 0 --max-zoom 6 --tile-size 256
"""

from __future__ import annotations

import argparse
import math
from pathlib import Path

from PIL import Image

# La textura global puede exceder el umbral de seguridad por tamaño de píxeles.
Image.MAX_IMAGE_PIXELS = None


MAX_LAT = 85.05112878


def lonlat_to_mercator_pixels(lon_deg: float, lat_deg: float, zoom: int, tile_size: int) -> tuple[float, float]:
    map_size = tile_size * (2 ** zoom)
    x = (lon_deg + 180.0) / 360.0 * map_size

    lat = max(-MAX_LAT, min(MAX_LAT, lat_deg))
    lat_rad = math.radians(lat)
    y = (1.0 - math.log(math.tan(lat_rad) + 1.0 / math.cos(lat_rad)) / math.pi) / 2.0 * map_size
    return x, y


def mercator_y_to_lat(y: float) -> float:
    n = math.pi - 2.0 * math.pi * y
    return math.degrees(math.atan(math.sinh(n)))


def build_tile(src: Image.Image, src_rows: list[int], zoom: int, tx: int, ty: int, tile_size: int, resample: int) -> Image.Image:
    """Construye la tesela remuestreando por filas (mucho mas rapido que pixel a pixel)."""
    map_size = tile_size * (2 ** zoom)
    src_w, src_h = src.size

    x0 = ((tx * tile_size + 0.5) / map_size) * (src_w - 1)
    x1 = ((tx * tile_size + tile_size - 0.5) / map_size) * (src_w - 1)
    left = int(max(0, min(src_w - 1, math.floor(min(x0, x1)))))
    right = int(max(0, min(src_w - 1, math.ceil(max(x0, x1)))))

    tile = Image.new("RGB", (tile_size, tile_size))
    for py in range(tile_size):
        gy = ty * tile_size + py
        sy = src_rows[gy]
        sy = max(0, min(src_h - 1, sy))

        row = src.crop((left, sy, right + 1, sy + 1))
        if row.width != tile_size:
            row = row.resize((tile_size, 1), resample=resample)
        tile.paste(row, (0, py))

    return tile


def generate_tiles(
    input_path: Path,
    output_root: Path,
    min_zoom: int,
    max_zoom: int,
    tile_size: int,
    quality: int,
    optimize_jpeg: bool,
    resample: int,
) -> None:
    src = Image.open(input_path).convert("RGB")

    output_root.mkdir(parents=True, exist_ok=True)

    for z in range(min_zoom, max_zoom + 1):
        tiles_per_axis = 2 ** z
        map_size = tile_size * tiles_per_axis

        # Mapea cada fila WebMercator a una fila de la equirectangular una sola vez por zoom.
        src_rows = []
        for gy in range(map_size):
            yn = (gy + 0.5) / map_size
            lat = mercator_y_to_lat(yn)
            sy = int(round(((90.0 - lat) / 180.0) * (src.height - 1)))
            src_rows.append(max(0, min(src.height - 1, sy)))

        z_dir = output_root / str(z)
        z_dir.mkdir(parents=True, exist_ok=True)

        progress_step = max(1, tiles_per_axis // 8)

        for x in range(tiles_per_axis):
            x_dir = z_dir / str(x)
            x_dir.mkdir(parents=True, exist_ok=True)

            for y in range(tiles_per_axis):
                tile_img = build_tile(src, src_rows, z, x, y, tile_size, resample)
                out_path = x_dir / f"{y}.jpg"
                tile_img.save(out_path, format="JPEG", quality=quality, optimize=optimize_jpeg)

            if (x + 1) % progress_step == 0 or x + 1 == tiles_per_axis:
                print(f"[tiles] zoom {z}: columna {x + 1}/{tiles_per_axis}")

        print(f"[tiles] zoom {z} generado ({tiles_per_axis}x{tiles_per_axis})")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Generar teselas XYZ desde textura global equirectangular")
    parser.add_argument("--input", required=True, type=Path, help="Imagen fuente equirectangular global")
    parser.add_argument("--output", required=True, type=Path, help="Directorio de salida tiles")
    parser.add_argument("--min-zoom", type=int, default=0)
    parser.add_argument("--max-zoom", type=int, default=6)
    parser.add_argument("--tile-size", type=int, default=256)
    parser.add_argument("--quality", type=int, default=82)
    parser.add_argument("--optimize-jpeg", action="store_true", help="Activa optimize en JPEG (mas lento)")
    parser.add_argument(
        "--resample",
        choices=["nearest", "bilinear", "lanczos"],
        default="bilinear",
        help="Filtro de remuestreo horizontal",
    )
    args = parser.parse_args()

    if args.min_zoom < 0 or args.max_zoom < args.min_zoom:
        raise SystemExit("Rango de zoom inválido")

    if not args.input.exists():
        raise SystemExit(f"No existe input: {args.input}")

    resample_map = {
        "nearest": Image.Resampling.NEAREST,
        "bilinear": Image.Resampling.BILINEAR,
        "lanczos": Image.Resampling.LANCZOS,
    }

    generate_tiles(
        input_path=args.input,
        output_root=args.output,
        min_zoom=args.min_zoom,
        max_zoom=args.max_zoom,
        tile_size=args.tile_size,
        quality=max(1, min(95, args.quality)),
        optimize_jpeg=args.optimize_jpeg,
        resample=resample_map[args.resample],
    )
