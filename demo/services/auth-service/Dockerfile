FROM node:20-alpine
WORKDIR /app
COPY index.js .
EXPOSE 3001
# Crash after 3s to trigger failure cascade
ENV CRASH_AFTER_MS=3000
CMD ["node", "index.js"]
