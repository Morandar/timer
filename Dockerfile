FROM node:20-alpine
WORKDIR /app

COPY package.json server.js index.html control.html display.html ./
COPY assets ./assets

# /data je mount point pro Fly.io volume — tam žijí templates.json
RUN mkdir -p /data

EXPOSE 3000
ENV PORT=3000
ENV HOST=0.0.0.0
ENV DATA_DIR=/data

CMD ["node", "server.js"]
