# syntax=docker/dockerfile:1

# ---- 1. Build the React app -------------------------------------------------
FROM node:22-alpine AS client
WORKDIR /build/client
COPY client/package.json client/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY client/ ./
RUN npm run build

# ---- 2. Install the server's production dependencies ------------------------
FROM node:22-alpine AS server-deps
WORKDIR /build/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

# ---- 3. Runtime image: Node serves the API and the built client -------------
FROM node:22-alpine
ENV NODE_ENV=production \
    PORT=3001
WORKDIR /app

# The server looks for the client at ../../client/dist relative to server/src.
COPY --from=server-deps /build/server/node_modules ./server/node_modules
COPY server/package.json ./server/
COPY server/src ./server/src
COPY server/scripts ./server/scripts
COPY --from=client /build/client/dist ./client/dist

# Without SMTP_HOST, e-mails are written here instead of being sent (see README > E-mail alerts).
ENV MAIL_PREVIEW_DIR=/data/mail-preview
RUN mkdir -p /data/mail-preview && chown -R node:node /data
VOLUME /data/mail-preview

USER node
WORKDIR /app/server
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"

CMD ["node", "src/index.js"]
