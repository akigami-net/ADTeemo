# Research probe only; this image does not relay real Discord audio.
FROM node:24.19.0-bookworm-slim
WORKDIR /probe
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund --fetch-timeout=30000 --fetch-retries=0 && npm cache clean --force
COPY probe.mjs ./
USER node
ENTRYPOINT ["node", "probe.mjs"]
