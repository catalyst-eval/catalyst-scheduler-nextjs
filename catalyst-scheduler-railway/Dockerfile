FROM node:18-alpine

WORKDIR /app

# Copy package files first (for better caching)
COPY package.json ./
COPY package-lock.json ./

# Install dependencies
RUN npm install --legacy-peer-deps

# Copy source code
COPY . .

# Build the application
RUN npm run build

# Expose port
EXPOSE 3000

# Start the app
CMD ["node", "dist/server.js"]