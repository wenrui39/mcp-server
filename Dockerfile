
FROM mcr.microsoft.com/playwright:v1.41.0-jammy

WORKDIR /app

COPY package.json ./

RUN npm install

COPY server.js ./


EXPOSE 3000

CMD ["npm", "start"]