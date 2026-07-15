# Stage 1: Build & Compile
FROM node:20-slim AS builder

WORKDIR /app

# Install system dependencies required for building native Node.js modules (e.g. node-datachannel)
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    cmake \
    libssl-dev \
    pkg-config \
    git \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Set build-time memory limit for Node.js/V8 compiler processes
ENV NODE_OPTIONS="--max-old-space-size=2048"

# Copy dependency manifests
COPY package*.json ./

# Clean-install all dependencies and build native extensions
RUN npm ci --no-audit --no-fund

# Copy application source code
COPY . .

# Run production compilation and client/server bundling
RUN npm run build

# Prune development dependencies to minimize the final stage footprint
RUN npm prune --production

# Stage 2: Minimalist Production Runner
FROM node:20-slim AS runner

WORKDIR /app

# Copy only production artifacts, shared files, and built dependencies
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/shared ./shared

# Enforce a strict memory ceiling on Node.js to match small hobby/free tiers (e.g. 512MB on Back4app)
# This prevents the OS/hypervisor OOM killer from abruptly terminating the container.
ENV NODE_ENV=production
ENV NODE_OPTIONS="--max-old-space-size=384"
ENV PORT=3000

# Expose designated port
EXPOSE 3000

# Directly launch the bundled server to avoid the memory overhead of spawning an extra npm parent process
CMD ["node", "dist/server/server.cjs"]
