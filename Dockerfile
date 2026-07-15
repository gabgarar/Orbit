# Imagen autocontenida para ejecutar Orbit en cualquier plataforma con Docker.
FROM node:22-bookworm-slim

WORKDIR /app

# El backend de propagación se inicia desde Node y necesita Python.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-venv \
    && rm -rf /var/lib/apt/lists/*

COPY server/package*.json ./server/
RUN npm ci --prefix server

COPY server/requirements.txt ./requirements.txt
RUN python3 -m venv /opt/venv \
    && /opt/venv/bin/pip install --no-cache-dir -r requirements.txt

COPY . .

ENV PATH="/opt/venv/bin:${PATH}"

EXPOSE 8100 8765

HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=5 \
    CMD node -e "fetch('http://127.0.0.1:8100/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "server/nodeServer.js"]
