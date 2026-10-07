FROM node:24-alpine AS build
WORKDIR /app
ADD source.tar.gz ./
RUN npm ci --no-audit --no-fund && npm run build

FROM nginx:stable-alpine
COPY --from=build /app/dist/ /usr/share/nginx/html/
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
