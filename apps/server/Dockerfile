# Build from the repo root:  docker build -f apps/server/Dockerfile -t proass-server .
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
RUN npm ci -w @proass/server -w @proass/shared --include-workspace-root
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/server apps/server
RUN npm run build -w @proass/server

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/
RUN npm ci --omit=dev -w @proass/server && npm cache clean --force
COPY --from=build /app/apps/server/dist apps/server/dist
WORKDIR /app/apps/server
EXPOSE 8787
USER node
CMD ["node", "dist/index.js"]
