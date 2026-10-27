# ADFC Codierauftrag — production image

# 1. Build stage
FROM node:26.12-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Release builds pass the git-tag version (ci.yml: --build-arg APP_VERSION=<vX.Y.Z
# without the v>); empty → vite falls back to package.json (08 § CI/CD). The
# PDF footer cell 'codierauftrag V{version}' shows it (06 § footer).
ARG APP_VERSION=""
# tsc (server) + vite build (client) + bundle check (no jsPDF/bwip-js in initial chunks)
RUN APP_VERSION=${APP_VERSION} npm run build
# prune to production deps for the runtime stage
RUN npm ci --omit=dev

# 2. Runtime stage
FROM node:26.12-slim
WORKDIR /app
ENV NODE_ENV=production
# the base image's 'node' user (uid/gid 1000) runs the app — non-root, and a
# FIXED id so operators can prepare the volume once: chown -R 1000:1000 ./data
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/client/dist ./client/dist
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/app.js"]
