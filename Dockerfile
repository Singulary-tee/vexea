FROM node:20-slim

WORKDIR /app

# Install build dependencies for compiling native node modules (e.g., node-datachannel)
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

# Copy package files
COPY package*.json ./

# Install dependencies including native modules
RUN npm install

# Copy application source code
COPY . .

# Build client-side assets and bundle server code
RUN npm run build

# Expose production port
EXPOSE 3000

# Run the production bundle
CMD ["npm", "start"]
