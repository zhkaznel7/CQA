FROM node:24-bookworm-slim

WORKDIR /app
# The build context is ai/. Only the mock and its explicit fixtures enter the image.
COPY mock-server.mjs http.mjs mock.mjs mock-na-fixtures.json ./

ENV NODE_ENV=production HOST=0.0.0.0 PORT=8001
USER node
EXPOSE 8001
CMD ["node", "mock-server.mjs"]
