FROM node:22-alpine
WORKDIR /app
COPY --chown=node:node server.mjs engine.mjs index.html bridge.js ./
USER node
ENV HOST=0.0.0.0 PORT=3100
EXPOSE 3100
CMD ["node", "server.mjs"]
