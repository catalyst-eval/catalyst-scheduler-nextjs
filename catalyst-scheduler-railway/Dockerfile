FROM node:18-alpine

WORKDIR /app

# Copy package.json and package-lock.json
COPY package.json package-lock.json ./

# First just try to install production dependencies
RUN npm install --only=production --no-package-lock

# Then install development dependencies
RUN npm install --no-package-lock

# Copy the rest of the application
COPY . .

# Build the application
RUN npm run build

# Expose port
EXPOSE 3000

# Start the app
CMD ["node", "dist/server.js"]