# Applivery SOAR — BlueSky stack image. Mirrors the original single-image
# pattern (see /Dockerfile for the FastAPI+React version being replaced):
# one container, Node serves both the API and the built Vue frontend.
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

ENV NODE_ENV=production
COPY backend/package*.json ./
RUN npm install --omit=dev

COPY --from=backend-builder /app/backend/dist ./dist
COPY --from=backend-builder /app/backend/node_modules/.prisma ./node_modules/.prisma
COPY --from=backend-builder /app/backend/node_modules/@prisma ./node_modules/@prisma
COPY --from=backend-builder /app/backend/prisma ./prisma
COPY --from=frontend-builder /app/frontend/dist /app/frontend/dist

EXPOSE 8000

# Applies any pending migrations before starting — safe to run on every
# boot (no-op if the schema is already current).
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/server.js"]
