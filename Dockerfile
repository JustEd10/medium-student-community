FROM node:24-alpine
WORKDIR /app

# зависимости ставим отдельным слоем, чтобы он кэшировался между сборками
COPY package*.json ./
RUN npm ci --no-audit --no-fund

COPY . .
RUN npm run build && npm prune --omit=dev

ENV NODE_ENV=production
ENV PORT=80
ENV DATA_DIR=/data
EXPOSE 80
CMD ["node", "server/server.js"]
