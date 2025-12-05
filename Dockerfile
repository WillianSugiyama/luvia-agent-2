# syntax=docker/dockerfile:1

# Use Node.js 22 (as required by package.json)
FROM node:22-slim AS base

WORKDIR /app

# Install dependencies
FROM base AS deps

COPY package*.json ./
RUN npm ci --omit=dev

# Build stage (install all deps including dev for tsx)
FROM base AS builder

COPY package*.json ./
RUN npm ci

COPY . .

# Production stage
FROM base AS runner

ENV NODE_ENV=production
ENV PORT=3000

# Create non-root user for security
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 appuser

WORKDIR /app

# Copy dependencies
COPY --from=deps /app/node_modules ./node_modules

# Copy source code (tsx runs TypeScript directly)
COPY --chown=appuser:nodejs . .

# Create data directory for SQLite
RUN mkdir -p /app/data && chown appuser:nodejs /app/data

USER appuser

EXPOSE 3000

# Run with tsx (TypeScript execution)
CMD ["npx", "tsx", "src/server.ts"]
