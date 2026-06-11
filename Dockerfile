FROM node:20-alpine

RUN apk add --no-cache python3 py3-pip make g++ ffmpeg yt-dlp ca-certificates vips-dev fftw-dev \
  && pip3 install --no-cache-dir --break-system-packages curl_cffi \
  && apk del py3-pip

WORKDIR /app

COPY package.json .
RUN npm install --production

COPY . .

RUN mkdir -p data/movies data/posters data/series data/live data/winscp/peliculas data/winscp/series

EXPOSE 80

ENV PORT=80
ENV NODE_ENV=production

CMD ["node", "server/index.js"]
