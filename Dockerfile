FROM node:20-slim
WORKDIR /app
RUN apt-get update && apt-get install -y python3 make g++ cmake libssl-dev pkg-config git ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build
EXPOSE 3000
CMD ["npm", "start"]