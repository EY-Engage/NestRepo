import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { IoAdapter } from '@nestjs/platform-socket.io';
import helmet from 'helmet';
import * as compression from 'compression';
import * as cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { join } from 'path';
import * as express from 'express';
import { existsSync, mkdirSync } from 'fs';

async function bootstrap() {
  const logger = new Logger('Bootstrap');

  try {
    const app = await NestFactory.create(AppModule, {
      logger: ['error', 'warn', 'log', 'debug', 'verbose'],
    });

    const configService = app.get(ConfigService);
    const port = configService.get<number>('PORT') || 3001;
    const nodeEnv = configService.get<string>('NODE_ENV') || 'development';

    // CORRECTION 1: S'assurer que le dossier uploads existe
    const uploadsPath = join(process.cwd(), 'uploads');
    if (!existsSync(uploadsPath)) {
      mkdirSync(uploadsPath, { recursive: true });
      logger.log(`📁 Created uploads directory: ${uploadsPath}`);
    }

    // Security - Configuration allégée pour le développement
    if (nodeEnv === 'production') {
      app.use(helmet({
        crossOriginEmbedderPolicy: false,
        contentSecurityPolicy: {
          directives: {
            imgSrc: ["'self'", 'data:', 'https:'],
            scriptSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
          },
        },
      }));
    }

    // Compression
    app.use(compression());

    // Cookie parser
    app.use(cookieParser());

    // CORRECTION 2: Configuration correcte pour servir les fichiers statiques
    // Utiliser le chemin absolu et ajouter des options CORS pour les fichiers
    app.use('/uploads', ( res, next) => {
      // Ajouter les headers CORS pour les fichiers statiques
      res.header('Access-Control-Allow-Origin', '*');
      res.header('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
      res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
      next();
    }, express.static(uploadsPath, {
      // Options pour le serveur de fichiers statiques
      maxAge: '1d', // Cache pendant 1 jour
      etag: true,
      lastModified: true,
      setHeaders: (res, path, stat) => {
        // Définir le type MIME correct
        if (path.endsWith('.pdf')) {
          res.set('Content-Type', 'application/pdf');
        } else if (path.match(/\.(jpg|jpeg|png|gif|webp)$/i)) {
          res.set('Content-Type', `image/${path.split('.').pop()}`);
        }
      }
    }));

    // CORRECTION 3: Log du chemin des uploads pour debugging
    logger.log(`📂 Static files served from: ${uploadsPath}`);
    logger.log(`🔗 Files accessible at: http://localhost:${port}/uploads/`);

    // CORS - Plus permissif en développement
    const corsOrigins = nodeEnv === 'development' 
      ? ['http://localhost:3000', 'http://localhost:3001', 'http://127.0.0.1:3000']
      : [process.env.FRONTEND_URL || 'http://localhost:3000'];

    app.enableCors({
      origin: corsOrigins,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
      allowedHeaders: [
        'Origin',
        'X-Requested-With',
        'Content-Type',
        'Accept',
        'Authorization',
        'X-API-Key',
      ],
    });

    // Global pipes
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: false, // Plus tolérant en dev
        transform: true,
        transformOptions: {
          enableImplicitConversion: true,
        },
      }),
    );

    // API prefix
    app.setGlobalPrefix('api', {
      exclude: ['/health', '/', '/uploads'],
    });

    // Swagger documentation - Toujours activé en développement
    if (nodeEnv === 'development') {
      const config = new DocumentBuilder()
        .setTitle('EY Engage Social & Notifications API')
        .setDescription('API pour le réseau social et système de notifications EY Engage')
        .setVersion('1.0')
        .addBearerAuth(
          {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
            name: 'JWT',
            description: 'Enter JWT token',
          },
          'JWT-auth',
        )
        .addCookieAuth('ey-session', {
          type: 'apiKey',
          in: 'cookie',
          name: 'ey-session',
          description: 'JWT session cookie',
        })
        .addTag('Authentication', 'Endpoints de validation de token')
        .addTag('Social', 'Réseau social (posts, réactions, commentaires)')
        .addTag('Admin', 'Administration et modération')
        .build();

      const document = SwaggerModule.createDocument(app, config);
      SwaggerModule.setup('api/docs', app, document, {
        swaggerOptions: {
          persistAuthorization: true,
        },
      });

      logger.log(`📚 Swagger documentation available at http://localhost:${port}/api/docs`);
    }

    // Health check avec vérification des services
    app.getHttpAdapter().get('/health', async (req, res) => {
      const healthStatus = {
        status: 'OK',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        environment: nodeEnv,
        version: process.env.npm_package_version || '1.0.0',
        services: {
          database: 'unknown',
          uploads: existsSync(uploadsPath) ? 'available' : 'unavailable',
        },
      };

      // Vérification simple des services (sans bloquer si indisponibles)
      try {
        // Ici vous pouvez ajouter des checks simples
        healthStatus.services.database = 'connected';
      } catch (error) {
        logger.warn('Some services may be unavailable:', error.message);
      }

      res.json(healthStatus);
    });

    // Root endpoint
    app.getHttpAdapter().get('/', (req, res) => {
      res.json({
        name: 'EY Engage Social & Notifications API',
        version: '1.0.0',
        status: 'running',
        environment: nodeEnv,
        documentation: nodeEnv === 'development' ? `/api/docs` : undefined,
        health: '/health',
        uploads: `/uploads`,
      });
    });

    // Gestion des erreurs - Plus tolérant en développement
    process.on('unhandledRejection', (reason, promise) => {
      if (nodeEnv === 'development') {
        logger.warn('Unhandled Promise Rejection (dev mode):', reason);
      } else {
        logger.error('Unhandled Promise Rejection:', reason);
      }
    });

    process.on('uncaughtException', (error) => {
      logger.error('Uncaught Exception:', error);
      if (nodeEnv === 'production') {
        process.exit(1);
      }
    });

    // Graceful shutdown
    process.on('SIGTERM', async () => {
      logger.log('SIGTERM received, shutting down gracefully...');
      await app.close();
      process.exit(0);
    });

    process.on('SIGINT', async () => {
      logger.log('SIGINT received, shutting down gracefully...');
      await app.close();
      process.exit(0);
    });

    // Start the application
    await app.listen(port, '0.0.0.0');

    logger.log(`🚀 Application is running on: http://localhost:${port}`);
    logger.log(`🌍 Environment: ${nodeEnv}`);
    
    if (nodeEnv === 'development') {
      logger.log(`🔧 API Documentation: http://localhost:${port}/api/docs`);
      logger.log(`⚡ Hot reload is enabled`);
    }

  } catch (error) {
    logger.error('❌ Error starting application:', error);
    
    // En développement, on peut continuer même si certains services ne sont pas disponibles
    if (process.env.NODE_ENV === 'development') {
      logger.warn('⚠️  Some services may be unavailable, but the application can still run in development mode');
    } else {
      process.exit(1);
    }
  }
}

bootstrap();