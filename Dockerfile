# Stratum Server: web app + API + report scheduler, with headless Chromium for PDF reports.
# Build:  docker build -t stratum-server .
# Run:    see docker-compose.yml (adds PostgreSQL)

# ---- build the web app and the server bundle
FROM node:22-bookworm AS build
WORKDIR /src
COPY package.json package-lock.json ./
# Skip Electron/Playwright downloads: not needed to build the web app and server.
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1 PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build && npm run build:server

# ---- runtime: Playwright's image already has Chromium and its system libraries
FROM mcr.microsoft.com/playwright:v1.63.0-noble
WORKDIR /app
ENV NODE_ENV=production PORT=8080 STATIC_DIR=/app/dist SQLJS_WASM_DIR=/app/server-dist STRATUM_DB_FILE=/data/stratum.db
RUN npm init -y >/dev/null && npm install --omit=dev --no-audit --no-fund playwright@1.63.0 oracledb@6.7.0
COPY --from=build /src/dist ./dist
COPY --from=build /src/server-dist ./server-dist
# SQLite file when DATABASE_URL is not set (PostgreSQL is recommended for teams).
RUN mkdir -p /data && chown pwuser /data
VOLUME /data
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:8080/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
USER pwuser
CMD ["node", "server-dist/server.cjs"]
