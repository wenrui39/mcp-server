FROM mcr.microsoft.com/playwright:v1.41.0-jammy

WORKDIR /app

COPY package.json ./

RUN npm install

COPY server.js ./

EXPOSE 10000

CMD ["npm", "start"]
