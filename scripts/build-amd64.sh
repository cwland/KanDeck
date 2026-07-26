#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Build KanDeck for an x86_64 / AMD64 server FROM an Apple-Silicon Mac.
# Requires Docker Desktop (buildx + QEMU emulation come bundled).
# ---------------------------------------------------------------------------
set -euo pipefail

IMAGE="${IMAGE:-kandeck}"
TAG="${TAG:-latest}"
PLATFORM="${PLATFORM:-linux/amd64}"

# One-time: create a buildx builder that supports multi-arch.
if ! docker buildx inspect kandeck-builder >/dev/null 2>&1; then
  echo "Creating buildx builder 'kandeck-builder'…"
  docker buildx create --name kandeck-builder --use
  docker buildx inspect --bootstrap
else
  docker buildx use kandeck-builder
fi

echo "Building ${IMAGE}:${TAG} for ${PLATFORM}…"

if [[ "${PUSH:-false}" == "true" ]]; then
  # Push straight to a registry (set IMAGE=registry/user/kandeck).
  docker buildx build --platform "${PLATFORM}" -t "${IMAGE}:${TAG}" --push .
  echo "Pushed ${IMAGE}:${TAG} (${PLATFORM})."
else
  # Load a local image (single-platform) for testing, or export a tarball
  # you can scp to the server and 'docker load'.
  docker buildx build --platform "${PLATFORM}" -t "${IMAGE}:${TAG}" \
    -o type=docker,dest=./kandeck-${TAG}-amd64.tar .
  echo "Wrote ./kandeck-${TAG}-amd64.tar"
  echo "Copy to server, then:  docker load -i kandeck-${TAG}-amd64.tar && docker compose up -d"
fi
