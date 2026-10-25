#!/usr/bin/env python3
"""Stamp a release version (e.g. 0.9.9) into the Roku manifest and package.json."""
import json, pathlib, re, sys

version = sys.argv[1].lstrip("v")
parts = (version.split(".") + ["0", "0", "0"])[:3]
if not all(p.isdigit() for p in parts):
    sys.exit(f"Version must look like 1.2.3, got {version!r}")
major, minor, build = parts
root = pathlib.Path(__file__).resolve().parent.parent

manifest = root / "manifest"
text = manifest.read_text()
for key, value in (("major_version", major), ("minor_version", minor), ("build_version", build)):
    text, n = re.subn(rf"^{key}=.*$", f"{key}={value}", text, flags=re.M)
    if n != 1:
        sys.exit(f"{key} not found in manifest")
manifest.write_text(text)

pkg = root / "package.json"
data = json.loads(pkg.read_text())
data["version"] = f"{major}.{minor}.{build}"
pkg.write_text(json.dumps(data, indent=2) + "\n")
print(f"Roku app version set to {major}.{minor}.{build}")
