FROM node:24-alpine
WORKDIR /app
COPY ai/*.mjs ./ai/
COPY prisma/seed/official-checklist.json ./prisma/seed/official-checklist.json
ENV HOST=0.0.0.0 PORT=8001 AI_PROVIDER=local
USER node
EXPOSE 8001
CMD ["node", "ai/server.mjs"]
