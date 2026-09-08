FROM oven/bun:1.3.14-slim@sha256:621f249399228db47cf34611ee662585e77e015250ed29d5d0932b2d3282f0b0
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
RUN git clone --filter=blob:none https://github.com/garrytan/gbrain.git /opt/gbrain && cd /opt/gbrain && git checkout --detach 5cfb84f1d3a809c70064c292c23db3d538d5c551 && bun install --frozen-lockfile --ignore-scripts
WORKDIR /app
COPY access.mjs server.mjs supabase-prod-ca-2021.crt ./
ENV GBRAIN_HOME=/tmp/hrmny-brain GBRAIN_SOURCE_ROOT=/opt/gbrain PORT=8080 NODE_EXTRA_CA_CERTS=/app/supabase-prod-ca-2021.crt
EXPOSE 8080
USER bun
CMD ["bun", "server.mjs"]
