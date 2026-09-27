# Flexee Reader — single-image deployment (Next.js). Content is mounted at runtime.
FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY . .
RUN npm run build
ENV NODE_ENV=production
EXPOSE 3000
CMD ["npm", "run", "start"]
