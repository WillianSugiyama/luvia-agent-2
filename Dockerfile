# syntax=docker/dockerfile:1

# Use Node.js 22 (as required by package.json)
FROM node:22-slim AS base

WORKDIR /app

# Production stage - simpler approach
FROM base AS runner

ENV NODE_ENV=production
ENV PORT=3000

WORKDIR /app

# Copy everything
COPY package*.json ./

# Install ALL dependencies (including tsx which is a devDependency)
RUN npm ci

# Copy source code
COPY . .

# Create data directory for SQLite
RUN mkdir -p /app/data

EXPOSE 3000

# Run with tsx (TypeScript execution)
CMD ["npx", "tsx", "src/server.ts"]
