"""Guardrail: every production package module must stay importable."""

import importlib
import pkgutil

import orbit_api


def test_every_orbit_api_module_imports():
    module_names = [item.name for item in pkgutil.walk_packages(orbit_api.__path__, f"{orbit_api.__name__}.")]
    assert module_names
    for module_name in module_names:
        importlib.import_module(module_name)
