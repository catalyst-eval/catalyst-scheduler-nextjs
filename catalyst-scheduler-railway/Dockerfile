FROM node:18-alpine

WORKDIR /app

# First, just copy package files to leverage Docker caching
COPY package*.json ./

# Install dependencies without any special flags
RUN npm install

# Copy the source code
COPY . .

# Debug information
RUN echo "Node version:" && node --version
RUN echo "NPM version:" && npm --version
RUN echo "TypeScript version:" && npx tsc --version
RUN ls -la
RUN find ./src -type f | sort

# Build the application
RUN npm run build

# Show built files for debugging
RUN ls -la dist

# Expose port
EXPOSE 3000

# Start the app
CMD ["node", "dist/server.js"]