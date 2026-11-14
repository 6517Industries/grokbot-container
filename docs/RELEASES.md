# Build, upgrade, and roll back

[Quick start](../README.md) · [Architecture](ARCHITECTURE.md) · [User administration](../MULTIUSER.md)

The Dockerfile performs the vendor-to-browser conversion at build time. It is repeatable, but not automatically compatible with every future Grok release. Only **1.0.3**, commit `be8eaf76ba888db05a6a8950922f5fc8bb4d14e9`, has been verified. Run these commands from the project directory with Docker configured for your host.

## 1. Select the vendor release

Inspect the vendor feed:

```sh
curl -fsS https://api2.cursor.sh/updates/api/download/stable/linux-arm64/sand
```

For x64, use `linux-x64` instead of `linux-arm64`. Obtain the exact version and commit from the release metadata/download URL. Do not assume a version number alone identifies the artifact. The build chooses the `.deb` architecture based on the target image (`arm64` or `amd64`). Native ARM64 is verified; an x64 runtime has not been tested here.

Set the candidate values and an unused image tag:

```sh
GROK_VERSION=NEW_VERSION
GROK_COMMIT=NEW_COMMIT
GROK_CANDIDATE="grokbot-web:${GROK_VERSION}-candidate"
docker build \
  --build-arg GROKBOT_VERSION="$GROK_VERSION" \
  --build-arg GROKBOT_COMMIT="$GROK_COMMIT" \
  -t "$GROK_CANDIDATE" .
```

To reproduce the verified vendor release, use `1.0.3` and the commit above. The image contains this project's current bridge source; record both the bridge source revision/archive and the vendor version/commit for each release. Keep the previous working image.

## 2. Run bridge checks

Requires Node 18+ locally:

```sh
node web/wire.test.cjs
node web/api.test.cjs
node web/http.test.cjs
node web/access.test.cjs
node web/gateway.test.cjs
```

These check wire encoding, coordinator isolation, argument validation, HTTP authentication, keys, and gateway routing. They do not prove compatibility with a new vendor release.

The build asserts expected preload/renderer markers and retains the original ASAR as `vendor.asar`. A failed assertion requires inspection of the new vendor bundle and an adjustment at the patch boundary; do not remove assertions simply to make a build succeed. Changes to coordinator protocol or tool schemas require corresponding transport/schema checks and live smoke tests. See the [source map](ARCHITECTURE.md#source-map).

## 3. Stop and back up

Finish current login attempts and coordinate downtime with users. Do not run two containers against the same profile volume. The following assumes the documented container `grokbot-web` and volume `grokbot-users`.

```sh
GROK_OLD_IMAGE=$(docker inspect --format '{{.Image}}' grokbot-web)
GROK_BACKUP="$HOME/grokbot-backups/$(date +%Y%m%d-%H%M%S)"
umask 077
mkdir -p "$GROK_BACKUP"
printf '%s\n' "$GROK_OLD_IMAGE" > "$GROK_BACKUP/image-id"
docker stop grokbot-web
docker run --rm -v grokbot-users:/data:ro "$GROK_OLD_IMAGE" \
  tar -C /data -czf - . > "$GROK_BACKUP/users.tar.gz"
tar -tzf "$GROK_BACKUP/users.tar.gz" > /dev/null
```

The backup contains credentials, authorization policy, user records, and app data. Keep it private, outside the source/build context, and off-host according to your backup policy. Confirm the commands succeed before continuing. Do not delete the named volume.

## 4. Start the candidate

Use an unused rollback container name; if `grokbot-web-rollback` already exists, choose a different name rather than deleting it blindly.

```sh
docker rename grokbot-web grokbot-web-rollback
docker run -d --name grokbot-web --init --restart unless-stopped \
  --log-opt max-size=10m --log-opt max-file=3 \
  -p 127.0.0.1:8088:8080 -v grokbot-users:/data "$GROK_CANDIDATE"
```

## 5. Smoke-test the release

- Open a signed-in user's browser with their owner/browser key. Verify the bot list and existing conversation.
- Open another user's origin. Verify its own sign-in state and that the first user's key cannot access it.
- Call `grok_list_bots` and `grok_read` through MCP or HTTP using a scoped key.
- Submit one explicitly authorized harmless test and retrieve the reply. Verify headless operation and browser/API coexistence.
- Test key expiry/revocation and read-only denial with temporary keys. Revoke temporary keys afterward.
- Restart the candidate and verify account persistence and API access again.
- Exercise any attachments, X connections, or other integrations you require; they are not covered by the transport unit tests.

Inspect browser errors and `docker logs --tail 100 grokbot-web` privately. Do not infer success merely from a healthy HTTP listener. Record the vendor version, commit, image ID, bridge source revision, and which smoke checks passed. Promote/tag the image only after those checks pass.

## Rollback

If the candidate has not changed profile formats, stopping/removing it and renaming/starting the retained old container may be sufficient. If compatibility is uncertain, restore the backup into a **new volume** and run the old image against that volume. This preserves the failed candidate's data for investigation:

```sh
docker stop grokbot-web
# Choose unused names for this rollback attempt.
docker rename grokbot-web grokbot-web-failed
docker volume create grokbot-users-restored
GROK_OLD_IMAGE=$(cat "$GROK_BACKUP/image-id")
docker run --rm -i -v grokbot-users-restored:/data "$GROK_OLD_IMAGE" \
  tar -C /data -xzf - < "$GROK_BACKUP/users.tar.gz"
docker run -d --name grokbot-web --init --restart unless-stopped \
  --log-opt max-size=10m --log-opt max-file=3 \
  -p 127.0.0.1:8088:8080 -v grokbot-users-restored:/data "$GROK_OLD_IMAGE"
```

After this recovery, the active volume is `grokbot-users-restored`; update deployment and backup commands accordingly. Restoring local data can roll back key revocations or other policy changes made after the backup. Cloud-side actions and messages are not undone by restoring a profile. Review those changes before allowing clients back in.
