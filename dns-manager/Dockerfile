# Base image is pinned by digest; Dependabot (docker ecosystem) proposes digest refreshes.

# ── Stage 1: Dependencies ─────────────────────────────────
FROM node:24-alpine@sha256:06d7adf3e0ef61a13f1d28682726366f97a15aa1888c934d3ecec86c33918b53 AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

# ── Stage 2: Build ────────────────────────────────────────
FROM node:24-alpine@sha256:06d7adf3e0ef61a13f1d28682726366f97a15aa1888c934d3ecec86c33918b53 AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN npm run build

# ── Stage 3: Production ──────────────────────────────────
FROM node:24-alpine@sha256:06d7adf3e0ef61a13f1d28682726366f97a15aa1888c934d3ecec86c33918b53 AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=10010
ENV HOSTNAME=0.0.0.0
# Read at runtime by the /api proxy (src/lib/bridge-proxy.ts). BRIDGE_TOKEN has no default:
# set it to the token the bridge was started with (-Token / DNS_BRIDGE_TOKEN).
ENV BRIDGE_URL=http://host.docker.internal:8650

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 --ingroup nodejs nextjs

# Copy standalone output
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

USER nextjs

EXPOSE 10010

CMD ["node", "server.js"]
