FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
ENV PORT=3100 BASE_PATH=/pavio-curto
EXPOSE 3100
# data/ guarda contas, pontos, torneios e doações: monte como volume para não perder
VOLUME ["/app/data"]
CMD ["node", "server.js"]
