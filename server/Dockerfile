# The WMS server image, built from the repository root (docker build -f server/Dockerfile .) by the deploy workflow
# (.github/workflows/deploy-aws.yml), and run on ECS Fargate: the API and the app (default command), the migration
# loop, tenant creation, the first console account and the nightly backup (one-off tasks with another command).

# 1. The app and the ops console, built to talk to the server (no warehouse data in it)
FROM node:22-alpine AS app
WORKDIR /src
COPY app/package.json app/package-lock.json app/
RUN cd app && npm ci
COPY server/src/shared server/src/shared
COPY server/src/core server/src/core
COPY server/src/migrate/runner.ts server/src/migrate/runner.ts
COPY server/migrations server/migrations
COPY server/templates server/templates
COPY app app
RUN cd app && npm run build:server

# 2. The server
FROM node:22-alpine AS server
WORKDIR /src/server
COPY server/package.json server/package-lock.json ./
RUN npm ci
COPY server/tsconfig.json ./
COPY server/src src
COPY server/test test
RUN npm run build

# 3. What runs
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
# The database instance's certificate is signed by the RDS certificate authority (migrations connect to it directly);
# RDS Proxy's certificate is public and needs nothing extra
ADD https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem /app/rds-global-bundle.pem
RUN chmod 644 /app/rds-global-bundle.pem
ENV NODE_EXTRA_CA_CERTS=/app/rds-global-bundle.pem
# pg_dump for the nightly backup (src/ops/backup.ts): the same major version as the database (PostgreSQL 17)
RUN apk add --no-cache postgresql17-client
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=server /src/server/dist/src dist/src
COPY server/migrations migrations
COPY server/templates templates
COPY --from=app /src/app/dist public
USER node
EXPOSE 8080
CMD ["node", "dist/src/main.js"]
