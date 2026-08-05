# Applivery SOAR — single-image build: one container, Node serves both the
# API and the built Vue frontend. This is the image docker-publish.yml ships
# to GitHub Container Registry (ghcr.io), and it also doubles as the
# API-only backend service in the split-deployment topology (see
# docker-compose.yml / frontend/Dockerfile).
# Build from the repo root: `docker build -f backend/Dockerfile .`

# ==========================================
# STAGE 1: Build the Vue 3 frontend
# ==========================================
FROM node:20-alpine AS frontend-builder
WORKDIR /app

# The frontend depends on the vendored BlueSky Vue component library via a
# relative path alias (frontend/vite.config.ts -> ../packages/bluesky-vue),
# so both trees need to be present at the same relative layout as the repo.
# bluesky-vue's own node_modules (vue, clsx, tailwind-merge, etc.) are
# gitignored, so they need installing here too — vue-tsc resolves each
# .vue file's imports relative to its own directory, and without this the
# build fails with "Cannot find module 'vue'" for every vendored component.
COPY packages/bluesky-vue ./packages/bluesky-vue
RUN cd packages/bluesky-vue && npm install

COPY frontend/package*.json ./frontend/
# See frontend/Dockerfile's matching comment: patches/ must exist before
# `npm install` runs, or patch-package's postinstall step silently no-ops
# and the build ships grid-layout-plus's original unpatched (hang-prone)
# code with no error or CI failure.
COPY frontend/patches ./frontend/patches
WORKDIR /app/frontend
RUN npm install
COPY frontend/ ./
RUN npm run build
# Compiled output now at /app/frontend/dist

# ==========================================
# STAGE 2: Build the Node/TS backend
# ==========================================
FROM node:20-alpine AS backend-builder
WORKDIR /app/backend
COPY backend/package*.json ./
RUN npm install
COPY backend/ ./
RUN npx prisma generate
RUN npm run build
# Compiled output now at /app/backend/dist, Prisma client generated

# ==========================================
# STAGE 3: Runtime
# ==========================================
# Layout mirrors the repo itself (/app/backend, /app/frontend as siblings)
# so app.ts's `../../frontend/dist` relative lookup (relative to
# backend/dist/app.js, same as in local dev) resolves correctly here too.
FROM node:20-alpine
WORKDIR /app/backend

# Puppeteer PDF report generation (Phase 7) needs a real Chromium — the
# bundled binary puppeteer-core would otherwise download isn't musl-libc
# compatible with Alpine anyway, so this uses puppeteer-core (no bundled
# download) plus Alpine's own `chromium` apk package instead. The extra
# libs are Chromium's own runtime dependencies under Alpine (same set
# documented by the Puppeteer troubleshooting guide for Alpine images).
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    freetype-dev \
    harfbuzz \
    ca-certificates \
    ttf-freefont
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

# gdmf.apple.com's certificate chain terminates in Apple's own Root CA,
# which is in neither Alpine's ca-certificates bundle nor Node's own
# compiled-in (Mozilla-derived) CA list -- Node ignores the OS trust store
# by default, so `apk add ca-certificates` above doesn't help this one.
# Without this, every Settings > OS Lifecycle GDMF fetch
# (modules/catalogs/gdmfCatalog.ts) fails with "self-signed certificate in
# certificate chain" even though the cert Apple serves is entirely
# legitimate. NODE_EXTRA_CA_CERTS only *adds* trust for this one root on
# top of Node's existing list -- unlike NODE_TLS_REJECT_UNAUTHORIZED=0, it
# doesn't disable verification for the Applivery API calls this same
# process makes.
COPY backend/certs/apple-root-ca.pem /app/backend/certs/apple-root-ca.pem
ENV NODE_EXTRA_CA_CERTS=/app/backend/certs/apple-root-ca.pem

ENV NODE_ENV=production
COPY backend/package*.json ./
RUN npm install --omit=dev

COPY --from=backend-builder /app/backend/dist ./dist
COPY --from=backend-builder /app/backend/node_modules/.prisma ./node_modules/.prisma
COPY --from=backend-builder /app/backend/node_modules/@prisma ./node_modules/@prisma
COPY --from=backend-builder /app/backend/prisma ./prisma
# Device-report script templates served as-is by Settings > Device Data
# Webhook (settings/deviceReportScripts.controller.ts) — not compiled, so
# they need an explicit copy alongside dist rather than riding along with it.
COPY --from=backend-builder /app/backend/scripts ./scripts
# Vendored Chart.js UMD bundle, inlined into every generated report's HTML
# so PDF rendering needs no network access at runtime (reports/reportTemplate.ts).
COPY --from=backend-builder /app/backend/assets ./assets
# Admin/developer guide markdown, served as-is by GET /api/help/:slug
# (modules/help/help.controller.ts) — same "not compiled, needs its own
# COPY" reasoning as scripts/ above.
COPY --from=backend-builder /app/backend/docs ./docs
COPY --from=frontend-builder /app/frontend/dist /app/frontend/dist

EXPOSE 8000

# Applies any pending migrations before starting — safe to run on every
# boot (no-op if the schema is already current).
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/server.js"]
