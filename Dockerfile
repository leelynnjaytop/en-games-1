# 构建阶段：用完整镜像，保证 better-sqlite3 有编译环境（预编译包拿不到时能回退到源码编译）
FROM node:20-bookworm AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# 运行阶段：只带运行时，镜像更小
FROM node:20-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    DB_PATH=/app/data/app.db
COPY --from=build /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
COPY public ./public
RUN mkdir -p /app/data
EXPOSE 3000
CMD ["node", "src/server.js"]
