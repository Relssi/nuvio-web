# Nuvio audio converter (docs/TRANSCODER.md). Runs on the Oracle Cloud VM:
#   docker build -t nuvio-transcoder transcoder
#   docker run -d --restart unless-stopped --name nuvio-transcoder \
#     -p 8090:8090 -e TRANSCODER_SECRET=... nuvio-transcoder
FROM node:22-bookworm-slim
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY server.mjs ./
ENV PORT=8090
EXPOSE 8090
USER node
CMD ["node", "server.mjs"]
