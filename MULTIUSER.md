# One container, multiple Grok users

[Quick start](README.md#quick-start) · [MCP and HTTP](docs/INTEGRATION.md) · [Build and releases](docs/RELEASES.md) · [Architecture](docs/ARCHITECTURE.md)

One root gateway supervises separate, unprivileged Grok processes inside the same container. Each user has a distinct Linux UID/GID, home directory, account profile, API token, X display with private authorization, and mode-600 Unix bridge socket. Workers do not listen on TCP ports. Only the gateway is published.

The gateway authenticates every HTTP and WebSocket request and routes it to the matching user's socket. Each browser uses a separate `USER.localhost` origin, keeping browser storage and cached HTTP authentication separate. API clients use `http://127.0.0.1:8088`: their bearer token selects their user.

## New installation

Use a Docker **named volume**, including on Colima. The macOS bind mount tested here did not enforce Linux ownership correctly; the service rejects unsuitable home ownership/modes. Do not use the old macOS directory bind mount for multi-user account storage.

```sh
docker build -t grokbot-web:multiuser .
docker volume create grokbot-users
docker run --rm -v grokbot-users:/data grokbot-web:multiuser \
  node /opt/grok-web/users.cjs add alice
docker run -d --name grokbot-web --init --restart unless-stopped \
  -p 127.0.0.1:8088:8080 -v grokbot-users:/data grokbot-web:multiuser
```

Add users while the service runs:

```sh
docker exec grokbot-web node /opt/grok-web/users.cjs add bob
docker exec grokbot-web node /opt/grok-web/users.cjs list
mkdir -p .tokens
chmod 700 .tokens
docker cp grokbot-web:/data/users/bob/home/.config/grok-web/api-token .tokens/bob
chmod 600 .tokens/bob
```

New user processes start within a few seconds. Open `http://bob.localhost:8088/`. At the browser HTTP authentication prompt, enter username `bob` and the contents of `.tokens/bob` as password. Each user then signs into their own Grok account through the official login flow.

`*.localhost` resolves to loopback in modern browsers. If your browser/OS does not resolve it, add the specific name to `/etc/hosts` as `127.0.0.1 bob.localhost`.

On a VPS, use `ssh -N -L 8088:127.0.0.1:8088 user@vps`, then visit the same browser URL locally. This deployment accepts localhost hostnames and plain HTTP only over loopback/tunnel; it is not a public HTTPS deployment. Do not expose port 8080 directly to the internet.

For MCP, use `mcp.cjs` with `GROK_URL=http://127.0.0.1:8088` and `GROK_TOKEN_FILE` pointing to that user's private token copy. A token for Alice cannot access Bob's hostname. The root gateway can read all profiles and tokens; give Docker/host administration access only to administrators.

## Migrate an existing single-user profile

Stop the old container before copying the profile so SQLite files are consistent. Keep the old profile as a rollback copy. Do not run old and new instances of the same account simultaneously during migration.

```sh
docker stop grokbot-web
docker rename grokbot-web grokbot-web-single-user
docker volume create grokbot-users
docker run --rm -v grokbot-users:/data -v "$PWD/data:/import:ro" \
  grokbot-web:multiuser sh -c 'mkdir -p /data/users/alice/home; cp -a /import/. /data/users/alice/home/; node /opt/grok-web/users.cjs add alice'
docker run -d --name grokbot-web --init --restart unless-stopped \
  -p 127.0.0.1:8088:8080 -v grokbot-users:/data grokbot-web:multiuser
```

Provisioning retains the imported API token and changes ownership of the copied home. Export a token copy using `docker cp` as above and update `GROK_TOKEN_FILE`. Existing clients using the old token still authenticate because its value is preserved. The browser now requires the user-specific hostname and bridge credentials.

## Updates and recovery

Follow the [build and release guide](docs/RELEASES.md) for version/commit selection, bridge checks, stopped-volume backup, candidate deployment, smoke tests, and rollback. Keep backups outside the source directory because they contain account credentials. Never delete the named volume during an upgrade.

## Verification and limits

Verified on Colima: two concurrent users under distinct Linux IDs; migrated account retains sign-in and returns its bot roster; the fresh user shows sign-in; both browser UIs work through authenticated WebSockets; cross-user hostname/token combinations are rejected; each worker is denied access to the other user's credential file and private socket. A second real account's full sign-in has not been tested.

There is one Electron process tree per user, so CPU/RAM use scales with active user count. Workers share the container's kernel, network, and resource budget. Separate Unix identities and private sockets protect ordinary profile/credential access; this is not a hardened isolation boundary against a compromised vendor process exploiting the shared OS. No per-user CPU/RAM quotas or user deletion UI is implemented. Key issuance/revocation is available through the admin CLI below. One browser connection per user remains supported, alongside concurrent API calls.

## Keys for a multi-user bot platform

Keep container administration on your trusted server. Issue a separate **tasks** key for each user's platform integration; do not give the platform their browser/legacy key. Your platform must choose the key from the authenticated platform-user identity, never from a caller-supplied target-user field. The gateway derives the Grok user from the key and rejects extra fields such as `userId` on tool calls.

```sh
# Prints the new secret once. Capture it directly in your private secrets store.
docker exec grokbot-web node /opt/grok-web/users.cjs issue alice tasks 30
# List IDs, scopes and expiration timestamps, without secret values:
docker exec grokbot-web node /opt/grok-web/users.cjs keys alice
# Revoke one key, or disable all access for a user:
docker exec grokbot-web node /opt/grok-web/users.cjs revoke alice KEY_ID
docker exec grokbot-web node /opt/grok-web/users.cjs disable alice
docker exec grokbot-web node /opt/grok-web/users.cjs enable alice
```

Scopes:

| Scope | Access |
| --- | --- |
| `read` | List bots and read conversations only |
| `tasks` | All four HTTP/MCP tools; no browser assets or WebSocket IPC |
| `browser` | Native browser UI; no HTTP tool API |
| `all` | Both surfaces; reserve for account owners |

Keys expire after 1–365 days (30 by default). New key secrets are stored only as SHA-256 hashes in root-owned `access.json`. Existing keys migrate as `legacy`, with `all` access and no expiry, so current clients keep working. Replace and revoke `legacy` when clients have moved to scoped keys. Rotation means issue a replacement, update the client, then revoke the old key. Your platform should store tokens encrypted and never send them to its end users or model prompts.

Policy changes reload within two seconds; revoked/expired/disabled browser connections close on the next one-second authorization check. Requests already dispatched to Grok may finish. Revocation or disabling **does not cancel existing tasks, routines, or X actions**, nor does it log out the account. Explicitly stop relevant work in Grok when required. Re-enabling restores access for still-valid keys.

Gateway limits: 128 KiB tool-call body, eight concurrent calls per user, 120 calls per minute per user, 20-second incoming-request deadline, and 65-second upstream inactivity timeout. Limits count across all of a user's keys. HTTP 429 includes `Retry-After`; do not blindly retry a task after an uncertain timeout. Use the same clientNonce and check transcript history. These are HTTP admission controls, not quotas for already-running Grok tasks or per-user CPU/RAM quotas.

Audit lines use `event=grok_api` and record user ID, tool name, HTTP status, timestamp, and a generated request ID. They omit prompts, transcripts, token values, and external URLs. HTTP 200 can contain a vendor failure envelope; callers must inspect the JSON status too. Vendor process logs are separate and can contain vendor diagnostics; restrict access to Docker logs. Configure Docker log retention for your deployment.

### X operations and approvals

The bridge delegates prompts to the selected user's existing bot and its connected X account(s). A `tasks` key can request external effects through those connections. It is not a read-only-X key. A `read` key can only read existing Grok conversations; it cannot ask Grok to perform new X searches.

Your platform must preserve the user's requested account, action, constraints, and approval requirements in the submitted task. Grok's approval cards remain in the browser; this bridge has no automatic approval endpoint. Natural-language instructions alone are not an enforceable X read/write permission boundary. If the platform needs guaranteed per-action X policies, implement a structured action/approval layer before exposing task submission to untrusted callers.

The container remains a localhost/tunnel deployment. Public HTTPS ingress, per-user resource quotas, full second-account login, and an independent adversarial security audit are still outstanding.

Live hardening checks passed: a temporary task key read the migrated account roster; read-only submission and task-key browser access were denied; revoked keys returned 401; disabling/re-enabling the test user took effect without a restart; revoking a browser key closed its established WebSocket. Temporary test keys were revoked. Existing browser and MCP credentials were preserved. No X action was performed during these checks.
