FROM node:20-bookworm-slim

# Install LibreOffice and fonts required for Excel/Word -> PDF conversion
RUN apt-get update && apt-get install -y \
    libreoffice \
    fonts-liberation \
    fonts-dejavu-core \
    fonts-noto-core \
    fonts-crosextra-carlito \
    fonts-crosextra-caladea \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Node dependencies first
COPY package*.json ./
RUN npm ci --omit=dev

# Copy server source code
COPY . .

ENV NODE_ENV=production
ENV LIBREOFFICE_BIN=/usr/bin/soffice

CMD ["npm", "start"]