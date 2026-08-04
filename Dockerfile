# Imagen autocontenida para ejecutar Orbit en cualquier plataforma con Docker.
FROM node:22-bookworm-slim

WORKDIR /app

# El backend de propagación se inicia desde Node y necesita Python.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-venv tar \
    && rm -rf /var/lib/apt/lists/*

COPY server/package*.json ./server/
COPY react-ui/package*.json ./react-ui/
RUN npm ci --prefix server && npm ci --prefix react-ui

COPY server/requirements.txt ./requirements.txt
RUN python3 -m venv /opt/venv \
    && /opt/venv/bin/pip install --no-cache-dir -r requirements.txt

# Keep runtime data out of the expensive test/build layer. The compose volume
# replaces config/ in development, and catalogue refreshes must not force all
# test suites and the React build to run again on the next restart.
COPY Dockerfile compose.yaml .dockerignore ./
COPY .scripts/ ./.scripts/
COPY server/ ./server/
COPY front/ ./front/
COPY react-ui/ ./react-ui/

RUN npm run test:node --prefix server \
    && npm run test:frontend --prefix server \
    && /opt/venv/bin/python -m pytest server/python/tests
RUN npm run build --prefix react-ui

COPY config/ ./config/
RUN node server/scripts/validate-image-config.js

ENV PATH="/opt/venv/bin:${PATH}"

EXPOSE 8100

HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=5 \
    CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 8100) + '/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "server/nodeServer.js"]
