FROM node:20-alpine AS base

# Install build tools needed for better-sqlite3 native bindings
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Copy source
COPY . .

# Ensure data directory exists (SQLite volume mount point)
RUN mkdir -p /app/data

EXPOSE 3000

ENV NODE_ENV=production

CMD ["node", "src/index.js"]
