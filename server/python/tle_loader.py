# tle_loader.py


def load_all_tles_from_config(config_file):
    """Carga múltiples TLEs desde un fichero local.

    El fichero debe contener grupos de 3 líneas:
    - nombre del satélite
    - línea 1 del TLE
    - línea 2 del TLE

    Los bloques pueden estar separados por líneas en blanco.
    """
    with open(config_file, "r", encoding="utf-8") as f:
        lines = [line.strip() for line in f if line.strip()]

    tles = []
    block = []

    for line in lines:
        block.append(line)
        if len(block) == 3:
            name, l1, l2 = block
            tles.append((name, l1, l2))
            block = []

    if block:
        raise ValueError(
            f"Archivo de TLEs incompleto: se esperaba un múltiplo de 3 líneas, pero quedaron {len(block)} línea(s) sin procesar."
        )

    print("TLEs cargados desde fichero:")
    for name, l1, l2 in tles:
        print(f"  - {name}")

    return tles


def main():
    config_file = "../../config/satellites.txt"
    tles = load_all_tles_from_config(config_file)
    print(f"\n🛰️ Se cargaron {len(tles)} TLEs correctamente\n")


if __name__ == "__main__":
    main()
