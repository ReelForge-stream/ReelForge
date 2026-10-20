#!/usr/bin/env python3
"""Adds a release to ReelForge's update feed (a Jellyfin plugin repository manifest).

Every ReelForge server registers this feed on startup and the server's daily
"Update Plugins" task installs the newest version whose targetAbi it supports.
"""
import argparse, json, pathlib, datetime

GUID = "6f1d0c52-8a3e-4c1b-9b7e-3d5a2e9f4c71"

p = argparse.ArgumentParser()
p.add_argument("manifest")
p.add_argument("--version", required=True)          # 0.2.0
p.add_argument("--target-abi", required=True)       # 12.2.0.0
p.add_argument("--source-url", required=True)
p.add_argument("--checksum", required=True)         # MD5 of the zip
p.add_argument("--changelog", default="")
a = p.parse_args()

path = pathlib.Path(a.manifest)
data = json.loads(path.read_text()) if path.exists() and path.read_text().strip() else []
plugin = next((x for x in data if x.get("guid") == GUID), None)
if plugin is None:
    plugin = {"guid": GUID, "versions": []}
    data.append(plugin)
plugin.update({
    "name": "ReelForge",
    "description": "New interface plus Media Manager: duplicate finder and GPU Space Saver.",
    "overview": "ReelForge for Windows",
    "owner": "ReelForge",
    "category": "General",
    "imageUrl": "https://raw.githubusercontent.com/ReelForge-stream/ReelForge/main/brand/png/app-icon-512.png",
})
version = a.version if a.version.count(".") == 3 else a.version + ".0"
plugin["versions"] = [v for v in plugin["versions"] if v.get("version") != version]
plugin["versions"].insert(0, {
    "version": version,
    "changelog": a.changelog,
    "targetAbi": a.target_abi,
    "sourceUrl": a.source_url,
    "checksum": a.checksum,
    "timestamp": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
})
path.write_text(json.dumps(data, indent=2) + "\n")
print(f"manifest: ReelForge {version} -> {a.source_url}")
