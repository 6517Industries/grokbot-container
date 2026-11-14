# MCP and HTTP integration

[Quick start](../README.md#quick-start) · [Key administration](../MULTIUSER.md#keys-for-a-multi-user-bot-platform) · [Releases](RELEASES.md)

## Authentication and platform routing

All calls use the shared endpoint `http://127.0.0.1:8088`. A bearer key selects the user; there is no target-user parameter. Issue a separate `tasks` key for each platform user, or `read` for transcript-only access. Your trusted server must map its authenticated user to the correct stored key. Never let a model or caller choose another user's credential.

Store keys in your secret store, not prompts or source control. Every key covers the user's bots within its scope; per-bot allowlists are not implemented. Browser access uses a separate `USER.localhost` origin with HTTP Basic authentication. Task keys cannot access the browser/IPC surface.

## MCP

The [README configuration](../README.md#3-connect-a-coding-tool) launches `mcp.cjs` over stdio. It requires Node 18+ and no npm dependencies. `GROK_TOKEN_FILE` points to a private text file containing only the token. `GROK_API_TOKEN` is an alternative secret environment variable and takes precedence if both are set. `GROK_URL` defaults to `http://127.0.0.1:8088`.

Copy `mcp-config.example.json` to your client configuration and replace the absolute paths. Local `mcp-config.json` is ignored by Git. Restart the MCP process after replacing its token file: the adapter reads the credential at startup.

For a remote container, run the SSH tunnel shown in the README and put a private copy of the user key on the MCP client machine. The MCP adapter does not need Docker or the user's Grok profile on the client.

## Tool arguments

All tools reject unknown arguments. Bot IDs come from `grok_list_bots`.

| Tool | Required arguments | Optional arguments |
| --- | --- | --- |
| `grok_list_bots` | None (`{}`) | None |
| `grok_send` | `agentId`, `prompt`, `clientNonce` | `sessionId` |
| `grok_read` | `agentId` | `limit` (1–500, default 100), `beforeSeq` (nonnegative integer), `sessionId` |
| `grok_interrupt` | `agentId` | `sessionId` |

Strings must be nonblank. Prompt length is limited to 100,000 JavaScript characters; other strings are limited to 512. The gateway also caps the entire UTF-8 request body at 128 KiB, so the byte limit may apply first.

## Task lifecycle

1. List bots and choose the intended bot and connected account.
2. Generate and retain a unique `clientNonce` for the logical task, such as a UUID.
3. Send the full prompt, including constraints and approval requirements.
4. Inspect the vendor response. `accepted: true` means queued/accepted, not finished.
5. Read recent transcript entries for progress, results, failures, or approval cards. Poll at a modest interval, such as every five seconds, within the per-user limits.
6. Complete required approvals in the browser. The bridge exposes no approval endpoint.

There is no separate job-completion endpoint. Responses retain the vendor's transcript structure. Bot text can appear in `send-message` entries with `message.type="text"` and `message.content`; other entries can contain tool activity or cards. Do not treat every new entry as a final answer. Use `sessionId` for a specific session and `beforeSeq` for older transcript pages.

A timeout has an unknown outcome. Read history before retrying and retain the same nonce; never blindly create a new nonce for the same task. The bridge does not automatically retry sends and does not claim exactly-once delivery. Interrupting a run does not undo external actions already taken.

## HTTP example

The following read-only call lists bots and keeps the key out of shell arguments. Run from the project directory after the README quick start:

```python
import json
import pathlib
import urllib.request

base = 'http://127.0.0.1:8088'
token = pathlib.Path('.tokens/alice-tasks').read_text().strip()

def call(name, **arguments):
    request = urllib.request.Request(
        base + '/api/call',
        data=json.dumps({'name': name, 'arguments': arguments}).encode(),
        headers={
            'Authorization': 'Bearer ' + token,
            'Content-Type': 'application/json',
        },
    )
    with urllib.request.urlopen(request, timeout=70) as response:
        result = json.load(response)
    if result.get('status') != 'ok':
        raise RuntimeError(result)
    return result['value']

roster = call('grok_list_bots')
print(roster)
```

After selecting a bot, explicitly submit a harmless test if desired:

```python
import uuid
agent_id = 'BOT_ID_FROM_ROSTER'
nonce = str(uuid.uuid4())  # Persist this with the task before sending.
print(call('grok_send', agentId=agent_id, clientNonce=nonce,
           prompt='Connectivity test: reply "Bridge connected". Do not use tools or take other actions.'))
# Run later to retrieve the response:
print(call('grok_read', agentId=agent_id, limit=20))
```

`GET /api/tools` with the same Authorization header returns tool descriptions and JSON schemas. `POST /api/call` accepts only `name` and `arguments` at the top level. An HTTP 200 response contains the vendor envelope, typically `{ "status": "ok", "value": ... }`; inspect it for vendor failures too. Gateway failures may be plain text. MCP wraps these as error results and preserves HTTP status and `Retry-After` where present.

## Errors and limits

| HTTP status | Meaning / action |
| --- | --- |
| 400 | Invalid JSON, tool, or arguments; correct the request |
| 401 | Missing, expired, revoked, disabled, or wrong-user key |
| 403 | Scope or origin restriction; use the appropriate authorized key |
| 404 / 405 | Unknown route or unsupported method |
| 413 / 415 | Body too large or missing `application/json` |
| 429 | Per-user rate/concurrency limit; honor `Retry-After` |
| 503 | Service unavailable, starting, or timed out; a submitted task may have an unknown outcome |

The gateway allows eight concurrent calls and 120 calls per minute per user, shared across keys. Worker calls time out after 60 seconds; gateway upstream inactivity times out after 65 seconds. These limits govern requests, not the duration or number of autonomous tasks already running in Grok. An unsigned-in user's task calls may remain unavailable until login completes.

API audit logs include user, tool, HTTP status, request ID, and time, without prompt or response contents. `X-Request-ID` correlates admitted calls with logs. Restrict vendor logs separately because their diagnostics may contain sensitive data.

## Using X

Grok uses the selected user's configured X connections. Specify the intended account and allowed action in the prompt. A task key is not a read-only-X permission, and natural-language constraints are not a strict authorization boundary. A `read` key reads existing transcripts but cannot initiate new X searches. For enforceable per-action posting or messaging approval, add a structured approval layer in your platform. See [X operations and approvals](../MULTIUSER.md#x-operations-and-approvals).
