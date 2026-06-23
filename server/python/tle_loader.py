# tle_loader.py
import requests

# Listas de Celestrak donde buscar
CELESTRAK_SOURCES = [
    "https://celestrak.org/NORAD/elements/active.txt",
    "https://celestrak.org/NORAD/elements/stations.txt",
    "https://celestrak.org/NORAD/elements/resource.txt",
    "https://celestrak.org/NORAD/elements/science.txt",
    "https://celestrak.org/NORAD/elements/earth-observation.txt",
    "https://celestrak.org/NORAD/elements/starlink.txt",
    "https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=tle"
]

def load_satellite_names(filename):
    with open(filename, "r") as f:
        return [l.strip() for l in f.readlines() if l.strip()]

def find_tle_for_satellite(name):
    name_upper = name.upper()

    for url in CELESTRAK_SOURCES:
        try:
            resp = requests.get(url, timeout=5)
            if resp.status_code != 200:
                continue

            lines = [l.strip() for l in resp.text.splitlines() if l.strip()]

            for i in range(len(lines) - 2):
                if lines[i].upper() == name_upper:
                    return lines[i+1], lines[i+2]

        except Exception:
            continue

    raise ValueError(f"No se encontró TLE para '{name}' en Celestrak")

def load_all_tles_from_config(config_file):
    names = load_satellite_names(config_file)
    tles = []

    for name in names:
        print(f"🔎 Buscando TLE para {name}...")
        l1, l2 = find_tle_for_satellite(name)
        print(f"✔ TLE encontrado para {name}")
        tles.append((name, l1, l2))

    return tles
