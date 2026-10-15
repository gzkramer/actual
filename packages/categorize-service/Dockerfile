# Builds the categorize service. Run from the repository root:
#   docker build -f packages/categorize-service/Dockerfile .

FROM node:24-bookworm AS builder

WORKDIR /app

COPY .yarn ./.yarn
COPY yarn.lock package.json .yarnrc.yml tsconfig.json ./
COPY packages ./packages

RUN yarn workspaces focus @actual-app/categorize-service
RUN yarn workspace @actual-app/categorize-service build

# Reinstall with production dependencies only for the runtime image.
RUN yarn workspaces focus @actual-app/categorize-service --production

FROM node:24-bookworm-slim AS prod

ARG CLAUDE_CODE_VERSION=2.1.296

RUN apt-get update && apt-get install -y tini \
    && apt-get clean -y && rm -rf /var/lib/apt/lists/*
RUN npm install -g @anthropic-ai/claude-code@${CLAUDE_CODE_VERSION} \
    && npm cache clean --force

WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/categorize-service/package.json ./
COPY --from=builder /app/packages/categorize-service/build ./

USER node

ENTRYPOINT ["/usr/bin/tini", "-g", "--"]
EXPOSE 8080
CMD ["node", "index.js"]
