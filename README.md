# Grok Bot Container

Run the actual Grok Bot browser UI and let coding tools use it through **MCP or HTTP**, with **multiple users in one container**. Each user signs into their own Grok account and gets separate credentials, storage, and API keys.

The browser renders native HTML/JavaScript. The official Linux Electron backend runs privately inside the container; there is no VNC or streamed desktop. This is an unofficial port, verified against Grok Bot **1.0.3**.

## Features

- Native browser access to the vendor UI and official xAI sign-in.
- Headless tools to list bots, submit tasks, read responses, and interrupt runs.
- User-specific Linux processes, private profiles, and authenticated routing.
- Expiring API keys with read, tasks, browser, or full-access scopes; revocation and user disabling.
- Persistent account storage, request limits, API audit records, and repeatable vendor-version builds.
- Access to each user's existing Grok capabilities and connected services, including X where configured in Grok. This bridge does not provide a separate X API.

## Quick start

Requires Docker on Linux or macOS with Colima, and access to a Grok Bot account. Run commands from this project directory. These steps create a **new installation**; see [migration](MULTIUSER.md#migrate-an-existing-single-user-profile) for an existing profile.

Clone the source before running the steps below:

```sh
git clone https://github.com/6517Industries/grokbot-container.git
cd grokbot-container
```

On macOS, first start Colima and select its Docker socket:

```sh
colima start
export DOCKER_HOST="unix://$HOME/.colima/default/docker.sock"
```

If Docker reports a missing macOS credential helper, create a local config:

```sh
mkdir -p .docker
printf '{}\n' > .docker/config.json
export DOCKER_CONFIG="$PWD/.docker"
```

### 1. Build and start

```sh
docker build -t grokbot-web:local .
docker volume create grokbot-users
docker run --rm -v grokbot-users:/data grokbot-web:local \
  node /opt/grok-web/users.cjs add alice
docker run -d --name grokbot-web --init --restart unless-stopped \
  --log-opt max-size=10m --log-opt max-file=3 \
  -p 127.0.0.1:8088:8080 -v grokbot-users:/data grokbot-web:local
```

Use a **Docker named volume**. The macOS bind mount tested here did not enforce the Linux ownership needed for user isolation.

### 2. Open your browser and sign in

Export Alice's initial owner key:

```sh
mkdir -p .tokens
chmod 700 .tokens
docker cp grokbot-web:/data/users/alice/home/.config/grok-web/api-token .tokens/alice-owner
chmod 600 .tokens/alice-owner
```

Open **http://alice.localhost:8088/**. At the browser authentication prompt, enter username `alice` and the contents of `.tokens/alice-owner` as password. On macOS, `pbcopy < .tokens/alice-owner` copies it to your clipboard.

Then click **Sign in** in Grok Bot and complete the official xAI login. Keep the container running during sign-in. The final vendor page may offer to open the desktop app; return to your browser tab—the container receives the login result through polling. Allow a few seconds for the service to start if you initially see a 503.

### 3. Connect a coding tool

Create a separate 30-day task key, without printing its secret to your terminal:

```sh
umask 077
docker exec grokbot-web node /opt/grok-web/users.cjs issue alice tasks 30 \
  > .tokens/alice-task-key.json
python3 -c 'import json,pathlib; p=pathlib.Path(".tokens/alice-task-key.json"); pathlib.Path(".tokens/alice-tasks").write_text(json.loads(p.read_text())["token"]+"\n")'
```

Keep both files private; the JSON also contains the key ID needed for revocation. Add this to your coding tool's MCP configuration, replacing `/absolute/path/grokbot-container` with this project's path. Requires **Node 18+** on the client; no npm install is needed.

```json
{
  "mcpServers": {
    "grokbot": {
      "command": "node",
      "args": ["/absolute/path/grokbot-container/mcp.cjs"],
      "env": {
        "GROK_URL": "http://127.0.0.1:8088",
        "GROK_TOKEN_FILE": "/absolute/path/grokbot-container/.tokens/alice-tasks"
      }
    }
  }
}
```

Reload the MCP connection, then ask your coding tool to **list the available Grok bots**. This is a read-only smoke check. For task submission, result retrieval, HTTP examples, and errors, see the [integration guide](docs/INTEGRATION.md).

## Available tools

| Tool | Purpose |
| --- | --- |
| `grok_list_bots` | List bots available to the authenticated user |
| `grok_send` | Submit a prompt to a bot; returns acceptance, not completion |
| `grok_read` | Read conversation entries, results, and approval cards |
| `grok_interrupt` | Request interruption of a bot run |

A user's API key determines their account; callers do not supply a target user ID. Each key can access all of that user's bots within its scope. There are no per-bot key restrictions.

## Documentation

| Guide | Covers |
| --- | --- |
| [MCP and HTTP integration](docs/INTEGRATION.md) | Tool arguments, task lifecycle, examples, errors, remote connections, and platform routing |
| [Multi-user administration](MULTIUSER.md) | Add users, sign-in, key scopes and rotation, disabling access, limits, X approvals, and migration |
| [Build and release guide](docs/RELEASES.md) | Convert future vendor versions, run checks, back up data, deploy, and roll back |
| [Architecture](docs/ARCHITECTURE.md) | Vendor patch boundaries, gateway, credential isolation, IPC transport, and source-file map |

## Remote access and limits

For a VPS, keep the published port on localhost and connect through a tunnel:

```sh
ssh -N -L 8088:127.0.0.1:8088 user@your-vps
```

Use the same browser and API URLs locally. Public HTTPS ingress is not implemented.

Verified: native UI, real sign-in, persistent sessions, headless task/response round trips, MCP, simultaneous browser/API access, separate user processes, key revocation, and credential-access isolation. A second real account's complete sign-in, attachments/media, clipboard, file dialogs, and live X operations remain unverified.

Task keys may cause external actions through Grok's connected services. Approval cards stay in Grok; the bridge does not approve them automatically. Revoking a key does not cancel already-running work. Processes share the container's kernel and resource budget; per-user CPU/RAM quotas and an independent adversarial security audit remain outstanding.
