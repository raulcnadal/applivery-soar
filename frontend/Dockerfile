# Applivery SOAR — split-deployment frontend image. Serves the built Vue 3
# SPA via Nginx and reverse-proxies /api/* to the backend service, so the
# browser only ever talks to one origin (no CORS configuration needed on the
# backend). Pairs with docker-compose.yml's `soar-frontend` + `soar-backend`
# services — the backend still uses the existing backend/Dockerfile
# unchanged (it doubles as both the single-image reference build
# docker-publish.yml ships, and the API-only backend service here; its own
# bundled frontend/dist just goes unused in split mode since this image's
# Nginx is what actually serves the SPA).
#
# Build from the repo root: `docker build -f frontend/Dockerfile .`

# ==========================================
# STAGE 1: Build the Vue 3 frontend
# ==========================================
FROM node:20-alpine AS frontend-builder
WORKDIR /app

# Same reasoning as backend/Dockerfile's frontend-builder stage: the
# frontend depends on the vendored BlueSky Vue component library via a
# relative path alias, so both trees need to be present at the same
# relative layout as the repo, and bluesky-vue's own node_modules need
# installing separately since they're gitignored.
COPY packages/bluesky-vue ./packages/bluesky-vue
RUN cd packages/bluesky-vue && npm install

COPY frontend/package*.json ./frontend/
# patches/ must be present BEFORE `npm install` runs, since patch-package
# (frontend/package.json's postinstall script) applies grid-layout-plus's
# safety-cap patch (frontend/patches/grid-layout-plus+1.1.1.patch) during
# install — copying it only in the later `COPY frontend/ ./` step below
# means postinstall silently finds no patches/ directory yet and no-ops
# (patch-package doesn't fail the build when there's nothing to apply), so
# the build would silently ship the original unpatched, hang-prone library
# every time despite the source fix being committed. Bit us for real: every
# rebuild kept producing the pre-fix bundle until this copy was reordered.
COPY frontend/patches ./frontend/patches
WORKDIR /app/frontend
RUN npm install
COPY frontend/ ./
RUN npm run build
# Compiled output now at /app/frontend/dist

# ==========================================
# STAGE 2: Runtime — Nginx serving the SPA + reverse-proxying /api
# ==========================================
FROM nginx:1.27-alpine
COPY --from=frontend-builder /app/frontend/dist /usr/share/nginx/html
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
