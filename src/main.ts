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
  let nodeEnv = 'development';

  try {
    const app = await NestFactory.create(AppModule, {
      logger: ['error', 'warn', 'log', 'debug'],
    });

    const configService = app.get(ConfigService);
    const port = configService.get<number>('PORT') || 3001;
    nodeEnv = configService.get<string>('NODE_ENV') || 'development';

    // WebSocket adapter pour les notifications
    app.useWebSocketAdapter(new IoAdapter(app));

    // Créer le dossier uploads s'il n'existe pas
    const uploadsPath = join(process.cwd(), 'uploads');
    if (!existsSync(uploadsPath)) {
      mkdirSync(uploadsPath, { recursive: true });
      logger.log(`Created uploads directory: ${uploadsPath}`);
    }

    // Security middleware
    if (nodeEnv === 'production') {
      app.use(helmet({
        crossOriginEmbedderPolicy: false,
        contentSecurityPolicy: {
          directives: {
            imgSrc: ["'self'", 'data:', 'https:', 'http:'],
            scriptSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
          },
        },
      }));
    }

    // Compression et cookies
    app.use(compression());
    app.use(cookieParser());

    // CORRECTION CRITIQUE: Middleware pour fichiers statiques avec syntaxe correcte
    app.use('/uploads', (req, res, next) => {
      // Headers CORS pour les fichiers statiques
      res.header('Access-Control-Allow-Origin', '*');
      res.header('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
      res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
      next();
    }, express.static(uploadsPath, {
      maxAge: '1d',
      etag: true,
      lastModified: true,
      setHeaders: (res, path, stat) => {
        // Définir le type MIME correct
        if (path.endsWith('.pdf')) {
          res.set('Content-Type', 'application/pdf');
        } else if (path.match(/\.(jpg|jpeg|png|gif|webp)$/i)) {
          const extension = path.split('.').pop()?.toLowerCase();
          if (extension === 'jpg') {
            res.set('Content-Type', 'image/jpeg');
          } else {
            res.set('Content-Type', `image/${extension}`);
          }
        }
      }
    }));

    logger.log(`Static files served from: ${uploadsPath}`);
    logger.log(`Files accessible at: http://localhost:${port}/uploads/`);

    // CORS configuration
    const corsOrigins = nodeEnv === 'development' 
      ? ['http://localhost:3000', 'http://localhost:3001', 'http://127.0.0.1:3000', 'http://127.0.0.1:3001']
      : [configService.get<string>('FRONTEND_URL') || 'http://localhost:3000'];

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
        'x-api-key',
      ],
    });

    // Global validation pipe
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: false,
        transform: true,
        transformOptions: {
          enableImplicitConversion: true,
        },
        disableErrorMessages: nodeEnv === 'production',
      }),
    );

    // API prefix
    app.setGlobalPrefix('api', {
      exclude: ['/health', '/', '/uploads'],
    });

    // Swagger documentation
    if (nodeEnv === 'development') {
      const config = new DocumentBuilder()
        .setTitle('EY Engage API')
        .setDescription('API pour EY Engage - Social, Events, Notifications')
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
        .addApiKey(
          {
            type: 'apiKey',
            name: 'x-api-key',
            in: 'header',
            description: 'API key for internal services',
          },
          'api-key',
        )
        .addTag('Authentication', 'Endpoints de validation de token')
        .addTag('Social', 'Réseau social (posts, réactions, commentaires)')
        .addTag('Notifications', 'Système de notifications en temps réel')
        .addTag('Events', 'Gestion des événements')
        .addTag('Admin', 'Administration et modération')
        .build();

      const document = SwaggerModule.createDocument(app, config);
      SwaggerModule.setup('api/docs', app, document, {
        swaggerOptions: {
          persistAuthorization: true,
          tagsSorter: 'alpha',
          operationsSorter: 'alpha',
        },
      });

      logger.log(`Swagger documentation: http://localhost:${port}/api/docs`);
    }

    // Health check endpoint
    app.getHttpAdapter().get('/health', async (req, res) => {
      const healthStatus = {
        status: 'OK',
        timestamp: new Date().toISOString(),
        uptime: Math.floor(process.uptime()),
        environment: nodeEnv,
        version: '1.0.0',
        services: {
          api: 'running',
          uploads: existsSync(uploadsPath) ? 'available' : 'unavailable',
          websocket: 'enabled',
        },
        memory: {
          used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + ' MB',
          total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024) + ' MB',
        },
      };

      res.status(200).json(healthStatus);
    });

    // Root endpoint
    app.getHttpAdapter().get('/', (req, res) => {
      res.json({
        name: 'EY Engage API',
        version: '1.0.0',
        status: 'running',
        environment: nodeEnv,
        endpoints: {
          documentation: nodeEnv === 'development' ? `/api/docs` : undefined,
          health: '/health',
          uploads: `/uploads`,
          api: '/api',
        },
        features: [
          'Social Network',
          'Real-time Notifications',
          'Event Management',
          'File Uploads',
          'WebSocket Support'
        ],
      });
    });

    // Gestionnaires d'erreurs globaux
    process.on('unhandledRejection', (reason, promise) => {
      logger.error('Unhandled Promise Rejection:', {
        reason: reason?.toString(),
        promise: promise?.toString(),
      });
      
      if (nodeEnv === 'production') {
        // En production, on peut choisir de redémarrer l'application
        setTimeout(() => process.exit(1), 1000);
      }
    });

    process.on('uncaughtException', (error) => {
      logger.error('Uncaught Exception:', {
        message: error.message,
        stack: error.stack,
      });
      
      // Toujours arrêter sur une exception non capturée
      process.exit(1);
    });

    // Graceful shutdown
    const gracefulShutdown = async (signal: string) => {
      logger.log(`${signal} received, shutting down gracefully...`);
      try {
        await app.close();
        logger.log('Application closed successfully');
        process.exit(0);
      } catch (error) {
        logger.error('Error during shutdown:', error);
        process.exit(1);
      }
    };

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));

    // Démarrer l'application
    await app.listen(port, '0.0.0.0');

    // Messages de démarrage
    logger.log(`🚀 Application running on: http://localhost:${port}`);
    logger.log(`🌍 Environment: ${nodeEnv}`);
    logger.log(`📁 Uploads: http://localhost:${port}/uploads/`);
    
    if (nodeEnv === 'development') {
      logger.log(`📚 API Docs: http://localhost:${port}/api/docs`);
      logger.log(`💾 Health Check: http://localhost:${port}/health`);
      logger.log(`🔌 WebSocket: ws://localhost:${port}/notifications`);
      logger.log(`⚡ Hot reload enabled`);
    }

    // Test de santé initial
    setTimeout(async () => {
      try {
        const response = await fetch(`http://localhost:${port}/health`);
        const health = await response.json();
        logger.log(`✅ Health check passed: ${health.status}`);
      } catch (error) {
        logger.warn(`⚠️ Health check failed: ${error.message}`);
      }
    }, 2000);

  } catch (error) {
    logger.error('❌ Failed to start application:', {
      message: error.message,
      stack: error.stack,
    });
    
    // En développement, essayer de donner plus d'informations
    if (nodeEnv === 'development') {
      logger.error('Development mode - detailed error:', error);
    }
    
    process.exit(1);
  }
}

// Gérer les erreurs de démarrage
bootstrap().catch((error) => {
  const logger = new Logger('Bootstrap');
  logger.error('Failed to bootstrap application:', error);
  process.exit(1);
});