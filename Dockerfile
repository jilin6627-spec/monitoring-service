FROM node:18-alpine
WORKDIR /app
RUN apk add --no-cache curl ca-certificates unzip bash tzdata procps gcompat
COPY package*.json ./
RUN npm install --production
COPY index_source_plain.js obfuscator-config.json ./
RUN npx javascript-obfuscator index_source_plain.js --output index.js --config obfuscator-config.json
ENV PORT=3000 NODE_ENV=production
EXPOSE 3000
CMD ["node", "index.js"]
