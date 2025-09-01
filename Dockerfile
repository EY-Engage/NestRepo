FROM node:18-alpine AS builder

WORKDIR /app

# Copier les fichiers package
COPY package*.json ./
COPY tsconfig*.json ./

# Installer les dépendances
RUN npm ci --only=production

# Copier le code source
COPY src/ ./src/

# Build l'application
RUN npm run build

# Stage de production
FROM node:18-alpine AS production

WORKDIR /app

# Créer un utilisateur non-root
RUN addgroup -g 1001 -S nodejs
RUN adduser -S nestjs -u 1001

# Copier les fichiers de production
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./

# Créer les dossiers nécessaires
RUN mkdir -p uploads/images uploads/files uploads/chat uploads/profiles logs
RUN chown -R nestjs:nodejs /app

# Exposer le port
EXPOSE 3001

# Changer vers l'utilisateur non-root
USER nestjs

# Healthcheck
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3001/health || exit 1

# Commande de démarrage
CMD ["node", "dist/main.js"]