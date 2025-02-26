FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package.json ./

# Install dependencies with regular npm install instead of npm ci
RUN npm install --force

# Copy source code
COPY . .

# Build the application
RUN npm run build

# Expose port
EXPOSE 3000

# Start the app
CMD ["node", "dist/server.js"]