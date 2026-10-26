#!/usr/bin/env python3
"""Reference tool for HardyOS app packages (.hardyapp, format 1). See packaging/hardyos/FORMAT.md.

  hardyapp.py validate <package dir or .hardyapp>
  hardyapp.py pack <package dir> --version 1.2.3 [-o out.hardyapp]
  hardyapp.py install <.hardyapp> --root DIR [--answer id=/path ...] [--gpu auto|none|nvidia|intel|amd] [--no-start]
  hardyapp.py uninstall <app id> --root DIR

install/uninstall do what HardyOS does, with DIR standing in for the server: datasets become folders under
DIR/pool/apps/<id>/, and the package and app.env go in DIR/var/lib/hardyos/apps/<id>/. That way a package can be
tried on any Linux machine with Docker. The validator needs Docker Compose (it checks the rendered config).
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
SCHEMA = HERE.parent / "packaging" / "hardyos" / "app.schema.json"
VENDORS = ("nvidia", "intel", "amd")
ALLOWED_CAPS = {"NET_BIND_SERVICE"}
# Variables HardyOS always sets (FORMAT.md); a package can't reuse these names for its own storage or inputs.
PROVIDED = {"APP_ID", "APP_IMAGE", "APP_UID", "APP_GID", "TZ", "HOST_NAME", "HOST_RENDER_DEVICE", "HOST_RENDER_GID", "HOST_VIDEO_GID"}


class PackageError(Exception):
    pass


# ---------------------------------------------------------------- loading


def load(src: Path) -> tuple[Path, dict, tempfile.TemporaryDirectory | None]:
    """Returns (folder with the package's files, manifest, temp dir to clean up)."""
    tmp = None
    if src.is_file():
        tmp = tempfile.TemporaryDirectory(prefix="hardyapp-")
        with tarfile.open(src, "r:gz") as tar:
            for m in tar.getmembers():
                if m.name.startswith("/") or ".." in Path(m.name).parts or not (m.isfile() or m.isdir()):
                    raise PackageError(f"Unsafe entry in package: {m.name}")
            tar.extractall(tmp.name, filter="data")
        folder = Path(tmp.name)
    else:
        folder = src
    try:
        manifest = json.loads((folder / "app.json").read_text())
    except FileNotFoundError:
        raise PackageError("app.json is missing")
    except json.JSONDecodeError as e:
        raise PackageError(f"app.json isn't valid JSON: {e}")
    return folder, manifest, tmp


def package_files(folder: Path) -> list[str]:
    return sorted(str(p.relative_to(folder)) for p in folder.rglob("*") if p.is_file() and p.name != "checksums.sha256")


def checksums(folder: Path) -> str:
    return "".join(f"{hashlib.sha256((folder / f).read_bytes()).hexdigest()}  {f}\n" for f in package_files(folder))


# ---------------------------------------------------------------- validation


def check_schema(manifest: dict) -> list[str]:
    try:
        import jsonschema  # type: ignore
    except ImportError:
        return ["(jsonschema isn't installed: pip install jsonschema; schema not checked)"]
    schema = json.loads(SCHEMA.read_text())
    v = jsonschema.Draft202012Validator(schema)
    return [f"app.json {'/'.join(map(str, e.path)) or '(top)'}: {e.message}" for e in sorted(v.iter_errors(manifest), key=str)]


def sample_env(manifest: dict, root: str = "/srv/hardytest") -> dict[str, str]:
    env = {
        "APP_ID": manifest["id"],
        "APP_IMAGE": manifest["image"],
        "APP_UID": "2001",
        "APP_GID": "2001",
        "TZ": "UTC",
        "HOST_NAME": "hardyos",
        "HOST_RENDER_DEVICE": "/dev/dri/renderD128",
        "HOST_RENDER_GID": "992",
        "HOST_VIDEO_GID": "44",
    }
    for s in manifest.get("storage", []):
        env[s["variable"]] = f"{root}/pool/apps/{manifest['id']}/{s['id']}"
    for i in manifest.get("inputs", []):
        env[i["variable"]] = f"{root}/shares/{i['id']}"
    return env


def compose_files(manifest: dict, gpu: str | None) -> list[str]:
    files = [manifest["compose"]]
    if gpu:
        files.append(manifest["gpu"]["vendors"][gpu]["compose"])
    return files


def render(folder: Path, manifest: dict, env: dict[str, str], gpu: str | None) -> dict:
    with tempfile.NamedTemporaryFile("w", suffix=".env", delete=False) as f:
        f.write("".join(f"{k}={v}\n" for k, v in env.items()))
        env_file = f.name
    try:
        cmd = ["docker", "compose", "--project-directory", str(folder), "--env-file", env_file]
        for c in compose_files(manifest, gpu):
            cmd += ["-f", str(folder / c)]
        cmd += ["config", "--format", "json"]
        # Only the env file supplies variables, like on HardyOS (nothing leaks in from this shell).
        clean = {k: v for k, v in os.environ.items() if k in ("PATH", "HOME", "DOCKER_HOST", "DOCKER_CONFIG")}
        r = subprocess.run(cmd, capture_output=True, text=True, env=clean)
        if r.returncode != 0:
            raise PackageError(f"docker compose rejected {' + '.join(compose_files(manifest, gpu))}: {r.stderr.strip()}")
        if "variable is not set" in r.stderr:
            raise PackageError(f"compose uses a variable HardyOS doesn't provide: {r.stderr.strip()}")
        return json.loads(r.stdout)
    finally:
        os.unlink(env_file)


def check_rules(config: dict, manifest: dict, env: dict[str, str], gpu: str | None) -> list[str]:
    """The safety rules from FORMAT.md, applied to the fully rendered Compose config."""
    errors: list[str] = []
    allowed_sources = {env[s["variable"]] for s in manifest.get("storage", [])} | {env[i["variable"]] for i in manifest.get("inputs", [])}
    services = config.get("services", {})
    if manifest["service"] not in services:
        errors.append(f"service '{manifest['service']}' isn't in {manifest['compose']}")
    label = f" (with gpu/{gpu})" if gpu else ""
    for name, svc in services.items():
        where = f"service '{name}'{label}"
        if svc.get("privileged"):
            errors.append(f"{where}: privileged containers aren't allowed")
        extra_caps = set(svc.get("cap_add") or []) - ALLOWED_CAPS
        if extra_caps:
            errors.append(f"{where}: cap_add {sorted(extra_caps)} isn't allowed")
        for key in ("pid", "ipc", "userns_mode"):
            if svc.get(key) == "host":
                errors.append(f"{where}: {key}: host isn't allowed")
        if svc.get("user") != f"{env['APP_UID']}:{env['APP_GID']}":
            errors.append(f"{where}: must run as \"${{APP_UID}}:${{APP_GID}}\" (got {svc.get('user')!r})")
        image = svc.get("image", "")
        if not image or image.endswith(":latest") or ":" not in image.rsplit("/", 1)[-1]:
            errors.append(f"{where}: image must be pinned to a version (got {image!r})")
        if name == manifest["service"] and image != manifest["image"]:
            errors.append(f"{where}: image must be ${{APP_IMAGE}} (got {image!r})")
        if manifest.get("network") == "host" and svc.get("network_mode") != "host":
            errors.append(f"{where}: app.json says network host but the service doesn't use network_mode: host")
        for vol in svc.get("volumes") or []:
            if vol.get("type") == "bind":
                src = vol.get("source", "")
                if "docker.sock" in src:
                    errors.append(f"{where}: mounting the Docker socket isn't allowed")
                elif src not in allowed_sources:
                    errors.append(f"{where}: host path {src} doesn't come from a storage or input variable")
        for dev in svc.get("devices") or []:
            src = dev.get("source") if isinstance(dev, dict) else str(dev).split(":")[0]
            if not gpu or src != "/dev/dri":
                errors.append(f"{where}: device {src} is only allowed as /dev/dri in a gpu overlay")
    return errors


def validate(src: Path) -> dict:
    folder, manifest, tmp = load(src)
    try:
        errors = [e for e in check_schema(manifest) if not e.startswith("(")]
        notes = [e for e in check_schema(manifest) if e.startswith("(")]
        if errors:
            raise PackageError("\n".join(errors))
        needed = [manifest["compose"], manifest["icon"]] + [v["compose"] for v in manifest.get("gpu", {}).get("vendors", {}).values()]
        missing = [f for f in needed if not (folder / f).is_file()]
        if missing:
            raise PackageError(f"missing files: {', '.join(missing)}")
        ids = [x["id"] for x in manifest.get("storage", []) + manifest.get("inputs", [])]
        variables = [x["variable"] for x in manifest.get("storage", []) + manifest.get("inputs", [])]
        if len(set(ids)) != len(ids) or len(set(variables)) != len(variables):
            raise PackageError("storage and input ids and variables must all be different")
        clash = PROVIDED & set(variables)
        if clash:
            raise PackageError(f"variables reserved for HardyOS: {sorted(clash)}")
        prefer = manifest.get("gpu", {}).get("prefer", [])
        unknown = [p for p in prefer if p not in manifest.get("gpu", {}).get("vendors", {})]
        if unknown:
            raise PackageError(f"gpu.prefer names vendors without an overlay: {unknown}")
        if (folder / "checksums.sha256").exists() and (folder / "checksums.sha256").read_text() != checksums(folder):
            raise PackageError("checksums.sha256 doesn't match the files")
        if src.is_file() and not (folder / "checksums.sha256").exists():
            raise PackageError("checksums.sha256 is missing")
        env = sample_env(manifest)
        problems: list[str] = []
        for gpu in [None, *manifest.get("gpu", {}).get("vendors", {})]:
            problems += check_rules(render(folder, manifest, env, gpu), manifest, env, gpu)
        if problems:
            raise PackageError("\n".join(problems))
        for n in notes:
            print(n, file=sys.stderr)
        return manifest
    finally:
        if tmp:
            tmp.cleanup()


# ---------------------------------------------------------------- pack


def pack(folder: Path, version: str, out: Path | None) -> Path:
    if not re.fullmatch(r"\d+\.\d+\.\d+", version):
        raise PackageError(f"version must look like 1.2.3 (got {version!r})")
    with tempfile.TemporaryDirectory(prefix="hardyapp-pack-") as tmp:
        stage = Path(tmp) / "pkg"
        shutil.copytree(folder, stage, ignore=shutil.ignore_patterns("checksums.sha256", ".*"))
        manifest = json.loads((stage / "app.json").read_text())
        manifest["version"] = version
        manifest["image"] = re.sub(r":[^:/]+$", f":{version}", manifest["image"])
        (stage / "app.json").write_text(json.dumps(manifest, indent=2) + "\n")
        (stage / "checksums.sha256").write_text(checksums(stage))
        out = out or Path(f"{manifest['name']}-{version}.hardyapp")
        buf = io.BytesIO()
        with tarfile.open(fileobj=buf, mode="w:gz") as tar:
            for f in sorted(p for p in stage.rglob("*") if p.is_file()):
                info = tar.gettarinfo(str(f), arcname=str(f.relative_to(stage)))
                info.uid = info.gid = 0
                info.uname = info.gname = "root"
                info.mtime = 0
                info.mode = 0o644
                with open(f, "rb") as fh:
                    tar.addfile(info, fh)
        out.write_bytes(buf.getvalue())
    validate(out)
    return out


# ---------------------------------------------------------------- install (what HardyOS does)


def detect_gpus() -> dict[str, str]:
    """vendor -> render node, from /sys like HardyOS's hardware detection."""
    found: dict[str, str] = {}
    ids = {"0x10de": "nvidia", "0x8086": "intel", "0x1002": "amd"}
    for node in sorted(Path("/sys/class/drm").glob("renderD*")):
        try:
            vendor = ids.get((node / "device" / "vendor").read_text().strip())
        except OSError:
            continue
        if vendor and vendor not in found:
            found[vendor] = f"/dev/dri/{node.name}"
    if "nvidia" not in found and Path("/dev/nvidiactl").exists():
        found["nvidia"] = ""
    return found


def host_ready(vendor: str) -> bool:
    if vendor == "nvidia":
        r = subprocess.run(["docker", "info", "--format", "{{json .Runtimes}}"], capture_output=True, text=True)
        return "nvidia" in r.stdout
    return any(Path("/dev/dri").glob("renderD*"))


def host_timezone() -> str:
    if os.environ.get("TZ"):
        return os.environ["TZ"]
    try:
        return Path("/etc/timezone").read_text().strip() or "UTC"
    except OSError:
        return "UTC"


def group_id(name: str, fallback: str) -> str:
    try:
        import grp
        return str(grp.getgrnam(name).gr_gid)
    except (KeyError, ImportError):
        return fallback


def project_name(app_id: str) -> str:
    return app_id.replace(".", "-")


def install(pkg: Path, root: Path, answers: dict[str, str], gpu_choice: str, start: bool) -> None:
    manifest = validate(pkg)
    app_id = manifest["id"]
    home = root / "var/lib/hardyos/apps" / app_id
    if home.exists():
        shutil.rmtree(home / "package", ignore_errors=True)
    (home / "package").mkdir(parents=True, exist_ok=True)
    with tarfile.open(pkg, "r:gz") as tar:
        tar.extractall(home / "package", filter="data")

    uid = gid = str(os.getuid()) if os.getuid() != 0 else "2001"
    env: dict[str, str] = {
        "APP_ID": app_id,
        "APP_IMAGE": manifest["image"],
        "APP_UID": uid,
        "APP_GID": gid,
        "TZ": host_timezone(),
        "HOST_NAME": os.uname().nodename,
        "HOST_RENDER_GID": group_id("render", "0"),
        "HOST_VIDEO_GID": group_id("video", "0"),
    }
    for s in manifest.get("storage", []):
        d = root / "pool/apps" / app_id / s["id"]
        d.mkdir(parents=True, exist_ok=True)
        os.chown(d, int(uid), int(gid))
        env[s["variable"]] = str(d)
    for i in manifest.get("inputs", []):
        value = answers.get(i["id"], "")
        if not value:
            if i["required"]:
                raise PackageError(f"'{i['label']}' is required: pass --answer {i['id']}=/path")
            value = str(home / "empty" / i["id"])  # read-only placeholder for a blank optional folder
            Path(value).mkdir(parents=True, exist_ok=True)
        elif not Path(value).is_dir():
            raise PackageError(f"{i['label']}: {value} isn't a folder")
        env[i["variable"]] = str(Path(value).resolve())

    vendors = manifest.get("gpu", {}).get("vendors", {})
    found = detect_gpus()
    gpu: str | None = None
    if gpu_choice == "auto":
        for v in manifest.get("gpu", {}).get("prefer", list(vendors)):
            if v in found and host_ready(v):
                gpu = v
                break
    elif gpu_choice != "none":
        if gpu_choice not in vendors:
            raise PackageError(f"this app has no {gpu_choice} option (has: {', '.join(vendors) or 'none'})")
        gpu = gpu_choice
    env["HOST_RENDER_DEVICE"] = found.get(gpu or "", "") or (found and next(iter(found.values()))) or ""

    (home / "app.env").write_text("".join(f"{k}={v}\n" for k, v in env.items()))
    os.chmod(home / "app.env", 0o600)
    (home / "gpu").write_text((gpu or "none") + "\n")
    cmd = compose_cmd(home, manifest, gpu)
    print(f"{manifest['name']} {manifest['version']}: graphics card {gpu or 'not used'}; data in {root / 'pool/apps' / app_id}")
    print("  " + " ".join(cmd + ["up", "-d"]))
    if not start:
        return
    subprocess.run(["docker", "pull", "-q", manifest["image"]], check=False)
    subprocess.run(cmd + ["up", "-d"], check=True)
    wait_healthy(manifest)


def compose_cmd(home: Path, manifest: dict, gpu: str | None) -> list[str]:
    cmd = ["docker", "compose", "--project-name", project_name(manifest["id"]), "--project-directory", str(home / "package"), "--env-file", str(home / "app.env")]
    for c in compose_files(manifest, gpu):
        cmd += ["-f", str(home / "package" / c)]
    return cmd


def wait_healthy(manifest: dict) -> None:
    h = manifest["health"]
    url = f"http://127.0.0.1:{h['port']}{h['path']}"
    deadline = time.time() + h.get("startupSeconds", 120)
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=5) as r:
                if 200 <= r.status < 300:
                    w = manifest["web"]
                    print(f"Running. Open http://<server>:{w['port']}{w['path']}")
                    if manifest.get("firstRun"):
                        print(manifest["firstRun"])
                    return
        except Exception:
            pass
        time.sleep(3)
    raise PackageError(f"{manifest['name']} didn't answer {url} within {h.get('startupSeconds', 120)} s")


def uninstall(app_id: str, root: Path) -> None:
    home = root / "var/lib/hardyos/apps" / app_id
    manifest = json.loads((home / "package/app.json").read_text())
    gpu = (home / "gpu").read_text().strip()
    subprocess.run(compose_cmd(home, manifest, None if gpu == "none" else gpu) + ["down"], check=True)
    print(f"Stopped and removed {manifest['name']}. Its data stays in {root / 'pool/apps' / app_id}.")


# ---------------------------------------------------------------- main


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    v = sub.add_parser("validate")
    v.add_argument("package", type=Path)
    p = sub.add_parser("pack")
    p.add_argument("folder", type=Path)
    p.add_argument("--version", required=True)
    p.add_argument("-o", "--output", type=Path)
    i = sub.add_parser("install")
    i.add_argument("package", type=Path)
    i.add_argument("--root", type=Path, required=True)
    i.add_argument("--answer", action="append", default=[], help="input id=/path")
    i.add_argument("--gpu", default="auto", choices=["auto", "none", *VENDORS])
    i.add_argument("--no-start", action="store_true")
    u = sub.add_parser("uninstall")
    u.add_argument("app_id")
    u.add_argument("--root", type=Path, required=True)
    a = ap.parse_args()
    try:
        if a.cmd == "validate":
            m = validate(a.package)
            print(f"{m['name']} {m['version']}: valid")
        elif a.cmd == "pack":
            out = pack(a.folder, a.version, a.output)
            print(f"Wrote {out}")
        elif a.cmd == "install":
            answers = dict(x.split("=", 1) for x in a.answer)
            install(a.package, a.root.resolve(), answers, a.gpu, not a.no_start)
        elif a.cmd == "uninstall":
            uninstall(a.app_id, a.root.resolve())
    except PackageError as e:
        print(f"error: {e}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
