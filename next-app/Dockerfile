# ============================================
# Stage 1: Install dependencies
# ============================================
FROM node:20-alpine AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

# Copy package files first for better layer caching
COPY package.json package-lock.json ./

# Install all dependencies (including devDependencies for prisma generate)
RUN npm ci

# Copy Prisma schema and generate the client
COPY prisma ./prisma/
RUN npx prisma generate

# ============================================
# Stage 2: Build the application
# ============================================
FROM node:20-alpine AS builder
WORKDIR /app

# Copy installed node_modules from deps stage
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/prisma ./prisma

# Copy application source
COPY . .

# Build Next.js
# Disable telemetry during build
ENV NEXT_TELEMETRY_DISABLED=1

RUN npm run build

# ============================================
# Stage 3: Production runner
# ============================================
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Create a non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Copy built assets from builder
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/prisma ./prisma

# Copy generated Prisma client
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma

# Create upload directory and set ownership
RUN mkdir -p /data/uploads && chown -R nextjs:nodejs /data/uploads

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
