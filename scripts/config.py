"""Shared settings for the data build scripts."""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BUILD = ROOT / "build"            # intermediate downloads (git-ignored)
PACKS = ROOT / "packs"            # optional offline map packs (git-ignored)
APP_DATA = ROOT / "public" / "data"  # small core data bundled with the app

# High Peaks + approach trailheads: Seward/Santanoni side to Giant/Rocky Peak,
# Elk Lake / Clear Pond to Whiteface / Wilmington.
WEST, SOUTH, EAST, NORTH = -74.32, 43.95, -73.60, 44.42
BBOX = (WEST, SOUTH, EAST, NORTH)

USER_AGENT = "adk-mapping-build/0.1 (personal hiking app)"

BUILD.mkdir(exist_ok=True)
PACKS.mkdir(exist_ok=True)
APP_DATA.mkdir(parents=True, exist_ok=True)
