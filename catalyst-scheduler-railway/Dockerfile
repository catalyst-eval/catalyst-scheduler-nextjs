FROM node:18-alpine

WORKDIR /app

# Copy package files first
COPY package*.json ./

# Install dependencies without using --force
RUN npm install --legacy-peer-deps

# Copy all source files
COPY . .

# Print TypeScript version for debugging
RUN npx tsc --version

# Create an empty tsconfig file if needed
RUN test -f tsconfig.json || echo '{"compilerOptions":{"target":"es2016","module":"commonjs","outDir":"./dist","esModuleInterop":true,"forceConsistentCasingInFileNames":true,"strict":true,"skipLibCheck":true}}' > tsconfig.json

# Create a dist directory
RUN mkdir -p dist

# Copy source files to dist instead of building with TypeScript
RUN cp -r src/* dist/

# Make sure server.js is executable
RUN chmod +x dist/server.js

# Expose port
EXPOSE 3000

# Start the app
CMD ["node", "dist/server.js"]