# syntax=docker/dockerfile:1

# ---- builder: install deps (with build tools in case better-sqlite3 has to
#       compile from source on this platform) ----
FROM node:22-bookworm-slim AS builder
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci --omit=dev

# ---- runtime: slim image with only node_modules + source ----
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    TZ=Asia/Bangkok
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY package*.json ./
COPY src ./src
# SQLite db + images live here; mounted as a volume at runtime so they persist.
RUN mkdir -p /app/data
CMD ["node", "src/index.js"]
