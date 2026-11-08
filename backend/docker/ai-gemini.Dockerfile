FROM node:24-bookworm-slim
WORKDIR /app
COPY gemini-server.mjs gemini.mjs http.mjs mock-request.json ./
COPY config/check-policies.v1.json config/na-policies.v1.json ./config/
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8001
USER node
EXPOSE 8001
CMD ["node", "gemini-server.mjs"]
