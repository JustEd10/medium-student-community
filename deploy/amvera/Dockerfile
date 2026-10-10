FROM node:24-alpine
WORKDIR /app
ADD source.tar.gz ./
RUN npm ci --no-audit --no-fund && npm run build && npm prune --omit=dev
ENV NODE_ENV=production
ENV PORT=80
ENV DATA_DIR=/data
EXPOSE 80
CMD ["node", "server/server.js"]
