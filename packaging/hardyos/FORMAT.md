# HardyOS app packages (`.hardyapp`), format 1

A `.hardyapp` file is everything HardyOS needs to install a Docker app in one click: what to run, what storage
to create, what to ask the user, and how to use the server's graphics card. It's a gzip-compressed tar with
these files at the top level:

| File | Required | What it is |
| --- | --- | --- |
| `app.json` | yes | The manifest (below). Validated against [`app.schema.json`](app.schema.json). |
| `compose.yaml` | yes | A Docker Compose file. It uses `${VARIABLES}` that HardyOS fills in. |
| `gpu/<vendor>.yaml` | no | Compose overlays added when the app runs on that graphics card (`nvidia`, `intel`, `amd`). |
| `icon.svg` (or `.png`) | yes | Square app icon for the App Store and the dock. |
| `README.md` | no | Longer notes shown on the app's page. |
| `checksums.sha256` | yes | `sha256sum` output for every other file. HardyOS refuses a package whose files don't match. |

The reference tool [`scripts/hardyapp.py`](../../scripts/hardyapp.py) validates, packs, and installs a
package exactly as described here. You can use it to test a package on any Linux machine with Docker.

## The manifest (`app.json`)

| Field | Meaning |
| --- | --- |
| `format` | Always `1` for this version of the format. |
| `id` | Reverse-DNS id, unique per app (`stream.reelforge.server`). It names the datasets and the Compose project. |
| `name`, `version`, `summary`, `description`, `category` | Shown in the App Store. `version` is semver. |
| `developer` `{name, website}`, `support`, `license` | Shown on the app page. |
| `icon` | Path of the icon inside the package. |
| `architectures` | e.g. `["amd64"]`. HardyOS hides apps that can't run on the server. |
| `requirements` `{memoryMB, storageGB}` | HardyOS warns before installing when the server has less. |
| `compose`, `service` | The Compose file and the name of the app's main service in it. |
| `image` | The container image, pinned to a version. HardyOS passes it to Compose as `APP_IMAGE` and pulls it before starting. |
| `network` | `host` or `bridge`. With `host`, the `ports` below must be free on the server. |
| `ports[]` `{port, protocol, label}` | Ports the app uses. HardyOS checks they're free and opens them in its firewall. |
| `storage[]` `{id, variable, label, snapshots, backup}` | Datasets HardyOS creates for the app's own data (see Storage). |
| `inputs[]` | Questions asked at install time (see Inputs). |
| `gpu` | Graphics card use (see Graphics cards). Leave it out if the app doesn't use one. |
| `web` `{port, path, open, label}` | Where the app's web page is. `open` is `window` (inside the HardyOS desktop) or `tab`. |
| `health` `{type, port, path, startupSeconds}` | How HardyOS knows the app started. Install succeeds when this answers 2xx within `startupSeconds`. |
| `firstRun` | One or two sentences shown after installing. |

## Storage

Each `storage` entry becomes a ZFS dataset `<pool>/apps/<id>/<storage id>`, owned by the app's user.
Its mount path is passed to Compose in the entry's `variable`.
- `snapshots: true`: the dataset is included in the pool's automatic snapshots.
- `backup: true`: the dataset is included in backups.

Uninstalling keeps the datasets unless the user ticks "Also delete its data". Deleting needs that explicit
confirmation, like every destructive storage operation in HardyOS.

## Inputs

Questions the install dialog asks. Format 1 has one type:
- **`folder`**: the user picks a share or folder on the server (or a mounted network share). Its path is
  passed in `variable`.
  - `access` is `read-only` or `read-write`. With `read-write`, `accessReason` explains why to the user, and
    HardyOS grants the app's user write access to that folder.
  - **Optional folders left blank** are set to an empty, read-only placeholder folder. This means the
    Compose file never needs conditionals.

## Graphics cards

`gpu.vendors` maps a vendor name to a Compose overlay. The names are `nvidia`, `intel` and `amd`, matching
HardyOS's hardware detection.

1. HardyOS checks which vendors the server has and which of their `hostRequires` it can meet:
   - `nvidia-driver` and `nvidia-container-toolkit`: HardyOS installs these when the user agrees.
   - `dri-render-node`: `/dev/dri/renderD*` exists.
2. It picks the first usable vendor in `gpu.prefer`. If there are several, the install dialog lets the user
   choose, or choose "Don't use the graphics card". The choice can be changed later from the app's settings.
3. The chosen overlay is added to the Compose command.

`gpu.required: true` means the app can't run without one, so the App Store greys it out on servers without
a usable card.

## Variables HardyOS always provides

| Variable | Value |
| --- | --- |
| `APP_ID` | The manifest `id` |
| `APP_IMAGE` | The manifest `image` |
| `APP_UID`, `APP_GID` | The app's own system user and group. Each app gets one, named `app-<short id>`. |
| `TZ` | The server's time zone (e.g. `America/Denver`) |
| `HOST_NAME` | The server's host name |
| `HOST_RENDER_DEVICE` | First GPU render node, e.g. `/dev/dri/renderD128` (empty when none) |
| `HOST_RENDER_GID`, `HOST_VIDEO_GID` | Group ids of `render` and `video` on the host |
| one per `storage` entry | That dataset's mount path |
| one per `input` | The user's answer |

HardyOS writes these to `/var/lib/hardyos/apps/<id>/app.env` (mode 0600) and keeps the unpacked package
next to it. It runs:

```
docker compose --project-name <id with dots as dashes> --env-file app.env -f compose.yaml [-f gpu/<vendor>.yaml] up -d
```

Updating repeats this with the new package, after pulling the new image. If the health check fails, the
update rolls back to the previous package and image. Compose's own `${VAR:-default}` syntax works as usual.

## Rules HardyOS enforces

These keep a package from getting more power than the user agreed to. HardyOS rejects a package that breaks
them:
- **No privileged containers:** no `privileged: true`, `cap_add` beyond `NET_BIND_SERVICE`, `pid: host`,
  `ipc: host`, or `/var/run/docker.sock` mounts.
- **Approved mounts only:** host paths in `volumes` must come from a `storage` or `input` variable.
  (`/dev/dri` is only allowed in a `gpu` overlay, as a device.)
- **Not root:** containers run as `${APP_UID}:${APP_GID}`.
- **Pinned images:** `image` must name an exact version (`:latest` is refused).
- **Matching checksums:** every file must match `checksums.sha256`.

Signing (an ed25519 `app.sig`, like HardyOS updates) is planned for format 2, when the App Store gets a
catalog.
