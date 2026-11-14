# Architecture and conversion boundaries

[Quick start](../README.md) · [Release process](RELEASES.md) · [Integration](INTEGRATION.md)

```text
Browser: USER.localhost ── owner/browser key ──┐
                                            │
Coding tool ── stdio MCP adapter ── HTTP ─────┼── Gateway :8080
Platform service ── HTTP + user API key ──────┘      │
                                                    ├── User A private Unix socket
                                                    │   Grok Electron + coordinator
                                                    │   Linux UID A / private home
                                                    │
                                                    └── User B private Unix socket
                                                        Grok Electron + coordinator
                                                        Linux UID B / private home
```

## Vendor conversion

The Dockerfile downloads the pinned official Linux `.deb`. `web/prepare.py` patches its ASAR archive to load our host, embed our preload relay, and serve the original renderer HTML in the browser. The private Electron window becomes a blank service host. Vendor backend bundles are not rewritten, apart from the main-entry bootstrap insertion.

The browser runs the vendor renderer and original preload API against an Electron shim. WebSocket messages carry IPC to the actual Electron renderer, preserving the backend's expected sender. A coordinator multiplexer separates browser and API request IDs and keeps headless calls available when the browser disconnects. The HTTP/MCP surface exposes four allowlisted operations; raw Electron IPC is available only to authenticated browser/full-access keys.

The build retains `/opt/Grok Bot/resources/vendor.asar` for comparison and checks expected markers. The original preload and renderer HTML are also preserved within the patched archive. These checks cover known structural assumptions, not every possible vendor change.

## Users and credentials

The root gateway provisions/supervises one unprivileged process tree per user. Each has a distinct UID/GID, mode-700 home, X display protected by Xauthority, and private Unix socket. User records, key hashes, and a pinned internal backend token are root-owned. The internal token authenticates gateway-to-worker API calls; newly issued external keys are stored only as hashes.

The Docker named volume stores user data at `/data/users/USER/`. Browser storage is separated by `USER.localhost` origins. A bearer token selects an HTTP caller's user; Basic authentication additionally checks the browser username. Policy changes reload without restarting Grok, and established browser connections are rechecked for revocation.

Workers share a kernel, network, and resource budget. This is process/file isolation inside one container, not separate-container or VM isolation. The service is currently published only on localhost and accessed remotely through SSH forwarding.

## Source map

| File | Responsibility |
| --- | --- |
| `Dockerfile` | Download the pinned vendor package, patch it, and start the gateway |
| `web/prepare.py` | ASAR patching and vendor-boundary assertions |
| `web/gateway.cjs` | User workers, authenticated proxying, scope/rate/concurrency controls, audit records |
| `web/users.cjs` | Admin CLI for users and key operations |
| `web/access.cjs` | Key hashing, issuance, expiry, revocation, and internal-token pinning |
| `web/host.cjs` | Vendor assets, browser WebSocket, worker API, and external-link handoff |
| `web/client.js` | Browser-side Electron shim |
| `web/relay.cjs` | Actual Electron preload IPC relay |
| `web/coordinator.cjs` | Browser/API multiplexing and coordinator lifecycle |
| `web/wire.js` | Binary and structured-value encoding |
| `web/api.cjs` | Tool schemas, validation, and vendor-call translation |
| `mcp.cjs` | Dependency-free stdio MCP adapter for clients |
| `web/*.test.cjs` | Focused transport, HTTP, key, and gateway checks |

`web-start.sh` is a retained single-user helper, not the supported startup or release workflow. Use `Dockerfile`, which starts `web/gateway.cjs`.
