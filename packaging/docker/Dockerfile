# ReelForge for Linux / NAS: Jellyfin 12.2 with the ReelForge module already installed.
# Build from the repository root:
#   docker build -f packaging/docker/Dockerfile --build-arg RF_VERSION=0.9.9 -t reelforge .
# With a module you already built (ReelForge.dll + meta.json in packaging/docker/prebuilt/):
#   docker build ... --build-arg PLUGIN_STAGE=prebuilt .
ARG JELLYFIN_TAG=12.2
ARG PLUGIN_STAGE=module

# 1. The web interface (compiled into the module)
FROM node:22-bookworm-slim AS web
WORKDIR /src/web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run build

# 2. The ReelForge module
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS module
ARG RF_VERSION=0.0.0
WORKDIR /src/server
COPY server/ ./
COPY --from=web /src/server/ReelForge/Web ./ReelForge/Web
RUN dotnet build ReelForge/ReelForge.csproj -c Release -o /out \
      -p:Version=${RF_VERSION} -p:AssemblyVersion=${RF_VERSION}.0 -p:FileVersion=${RF_VERSION}.0 \
 && mkdir -p /plugin && cp /out/ReelForge.dll /plugin/ \
 && printf '{"category":"General","guid":"6f1d0c52-8a3e-4c1b-9b7e-3d5a2e9f4c71","name":"ReelForge","description":"New interface plus Media Manager","overview":"ReelForge","owner":"ReelForge","targetAbi":"12.2.0.0","version":"%s.0","timestamp":"%s","changelog":"","status":"Active","autoUpdate":true,"assemblies":["ReelForge.dll"]}\n' \
      "${RF_VERSION}" "$(date -u +%FT%TZ)" > /plugin/meta.json

# 2b. Or a module built beforehand (only used with PLUGIN_STAGE=prebuilt)
FROM scratch AS prebuilt
COPY packaging/docker/prebuilt/ /plugin/

FROM ${PLUGIN_STAGE} AS plugin

# 3. Jellyfin + the module
FROM jellyfin/jellyfin:${JELLYFIN_TAG}
ARG RF_VERSION=0.0.0
ENV RF_VERSION=${RF_VERSION}
COPY --from=plugin /plugin/ /usr/share/reelforge/plugin/
COPY packaging/docker/rf-entrypoint.sh /usr/local/bin/rf-entrypoint.sh
RUN chmod 0755 /usr/local/bin/rf-entrypoint.sh
LABEL org.opencontainers.image.title="ReelForge" \
      org.opencontainers.image.description="Self-hosted media server: Jellyfin with the ReelForge interface, Media Manager and Space Saver" \
      org.opencontainers.image.source="https://github.com/ReelForge-stream/ReelForge" \
      org.opencontainers.image.url="https://reelforge.stream" \
      org.opencontainers.image.version="${RF_VERSION}"
EXPOSE 8096/tcp 7359/udp
HEALTHCHECK --interval=30s --timeout=10s --start-period=90s --retries=3 CMD curl -fsS http://localhost:8096/health || exit 1
ENTRYPOINT ["/usr/local/bin/rf-entrypoint.sh"]
