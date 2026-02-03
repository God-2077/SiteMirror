# 使用官方Node.js运行时作为父镜像
FROM node:20-alpine

# 设置容器内的工作目录
WORKDIR /usr/src/app

# 将package.json和package-lock.json（如果有）复制到工作目录
COPY package*.json ./

# 安装依赖
RUN npm ci --only=production

# 将项目源代码复制到容器中
COPY . .

# 告诉Docker容器在运行时监听3000端口
EXPOSE 3000

# 定义环境变量
ENV NODE_ENV=production
ENV PORT=3000

# 在容器启动时运行应用
CMD [ "node", "index.js" ]
