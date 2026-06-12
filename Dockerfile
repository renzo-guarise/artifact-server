FROM node:20-slim

WORKDIR /app

# Install build tools for better-sqlite3 native compilation
RUN apt-get update -q && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm install --production

COPY server.js ./
RUN mkdir -p artifacts

EXPOSE 3456
CMD ["node", "server.js"]
