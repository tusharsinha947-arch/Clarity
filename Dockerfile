FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY index.html server.mjs ./
ENV NODE_ENV=production
EXPOSE 3000
CMD ["npm", "start"]
