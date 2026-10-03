# The Recall app: a dependency-free Node server. Used by Railway (see docs/DEPLOY.md) and for local container runs.
FROM node:22-alpine
WORKDIR /app
COPY package.json server.mjs index.html app.html app.js app.css ./
COPY lib ./lib
COPY assets ./assets
# Accounts, kits and images live in DATA_DIR; mount a volume there so they survive redeploys. The directory is owned
# by the unprivileged `node` user the server runs as; a named Docker volume inherits that ownership on first use.
# RECALL_CONTAINER tells the server to bind every interface even if an env file sets HOST to a loopback address.
ENV NODE_ENV=production HOST=:: PORT=3000 DATA_DIR=/data TRUST_PROXY=1 RECALL_CONTAINER=1
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 3000
CMD ["node", "server.mjs"]
