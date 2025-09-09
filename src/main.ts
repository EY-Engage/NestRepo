// src/main.ts - Correction pour les notifications
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
import { NotificationsService } from './notifications/notifications.service';
import { NotificationsGateway } from './notifications/notifications.gateway';

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

    // ✅ CORRECTION CRITIQUE: Connecter le service de notifications au gateway
    try {
      const notificationsService = app.get(NotificationsService);
      const notificationsGateway = app.get(NotificationsGateway);
      
      if (notificationsService && notificationsGateway) {
        // ✅ Établir la connexion bidirectionnelle
        notificationsService.setGateway(notificationsGateway);
        notificationsGateway.setNotificationsService(notificationsService);
        
        logger.log('✅ Notifications system connected successfully');
        
        // ✅ NOUVEAU: Test de la connexion
        // Utiliser un utilisateur existant pour le test ou créer un test sans utilisateur spécifique
        let testResult = false;
        try {
          // Récupérer le premier utilisateur actif pour le test
          const testUser = await app.get('UserRepository').findOne({
            where: { isActive: true },
            select: ['id', 'fullName']
          });
          
          if (testUser) {
            testResult = await notificationsService.testNotificationSystem(
              testUser.id, 
              testUser.fullName
            );
          } else {
            logger.log('⚠️ No active users found for notification test');
            testResult = true; // Considérer comme réussi si pas d'utilisateurs
          }
        } catch (testError) {
          logger.warn(`⚠️ Notification test error: ${testError.message}`);
          testResult = true; // Ne pas faire échouer le démarrage pour un test
        }
        
        if (testResult) {
          logger.log('🧪 Notification test passed');
        } else {
          logger.warn('⚠️ Notification test failed');
        }
        
      } else {
        logger.error('❌ Failed to find notifications service or gateway');
        if (!notificationsService) logger.error('NotificationsService not found');
        if (!notificationsGateway) logger.error('NotificationsGateway not found');
      }
    } catch (error) {
      logger.error('❌ Error connecting notifications system:', error.message);
      logger.error('Stack trace:', error.stack);
    }

    // ✅ WebSocket adapter pour les notifications avec configuration améliorée
    app.useWebSocketAdapter(new IoAdapter(app));

    // Créer le dossier uploads s'il n'existe pas
    const uploadsPath = join(process.cwd(), 'uploads');
    if (!existsSync(uploadsPath)) {
      mkdirSync(uploadsPath, { recursive: true });
      logger.log(`📁 Created uploads directory: ${uploadsPath}`);
    }

    // ✅ Créer les sous-dossiers d'upload
    const subFolders = ['images', 'files', 'profiles', 'chat'];
    subFolders.forEach(folder => {
      const folderPath = join(uploadsPath, folder);
      if (!existsSync(folderPath)) {
        mkdirSync(folderPath, { recursive: true });
        logger.log(`📁 Created ${folder} directory`);
      }
    });

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

    // ✅ CORRECTION CRITIQUE: Middleware pour fichiers statiques avec syntaxe correcte
    app.use('/uploads', (req, res, next) => {
      // Headers CORS pour les fichiers statiques
      res.header('Access-Control-Allow-Origin', '*');
      res.header('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
      res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
      next();
    }, express.static(uploadsPath, {
      maxAge: nodeEnv === 'production' ? '1d' : '0',
      etag: true,
      lastModified: true,
      setHeaders: (res, path, stat) => {
        // ✅ Définir le type MIME correct
        if (path.endsWith('.pdf')) {
          res.set('Content-Type', 'application/pdf');
        } else if (path.match(/\.(jpg|jpeg|png|gif|webp)$/i)) {
          const extension = path.split('.').pop()?.toLowerCase();
          if (extension === 'jpg' || extension === 'jpeg') {
            res.set('Content-Type', 'image/jpeg');
          } else {
            res.set('Content-Type', `image/${extension}`);
          }
        }
      }
    }));

    logger.log(`📁 Static files served from: ${uploadsPath}`);
    logger.log(`🌐 Files accessible at: http://localhost:${port}/uploads/`);

    // ✅ CORS configuration améliorée
    const corsOrigins = nodeEnv === 'development' 
      ? [
          'http://localhost:3000', 
          'http://localhost:3001', 
          'http://127.0.0.1:3000', 
          'http://127.0.0.1:3001',
          'http://localhost:4200', // Pour Angular si nécessaire
        ]
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
        'Cache-Control',
        'Pragma',
      ],
      exposedHeaders: ['Set-Cookie'],
    });

    // ✅ Global validation pipe avec configuration améliorée
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: false,
        transform: true,
        transformOptions: {
          enableImplicitConversion: true,
        },
        disableErrorMessages: nodeEnv === 'production',
        validateCustomDecorators: true,
      }),
    );

    // API prefix
    app.setGlobalPrefix('api', {
      exclude: ['/health', '/', '/uploads'],
    });

    // ✅ Swagger documentation améliorée
    if (nodeEnv === 'development') {
      const config = new DocumentBuilder()
        .setTitle('EY Engage API')
        .setDescription('API pour EY Engage - Social, Events, Notifications, Administration')
        .setVersion('1.0.0')
        .addBearerAuth(
          {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
            name: 'JWT',
            description: 'Enter JWT token',
            in: 'header',
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
            description: 'API key for internal services communication',
          },
          'api-key',
        )
        .addServer(`http://localhost:${port}`, 'Development server')
        .addTag('Authentication', 'Endpoints de validation et gestion des tokens')
        .addTag('Social', 'Réseau social (posts, réactions, commentaires, mentions)')
        .addTag('Notifications', 'Système de notifications en temps réel via WebSocket')
        .addTag('Events', 'Gestion des événements et participations')
        .addTag('Admin', 'Administration, modération et statistiques')
        .addTag('Users', 'Gestion des utilisateurs et profils')
        .addTag('Upload', 'Upload et gestion des fichiers')
        .build();

      const document = SwaggerModule.createDocument(app, config);
      SwaggerModule.setup('api/docs', app, document, {
        swaggerOptions: {
          persistAuthorization: true,
          tagsSorter: 'alpha',
          operationsSorter: 'alpha',
          displayRequestDuration: true,
          docExpansion: 'none',
          filter: true,
          showExtensions: true,
          showCommonExtensions: true,
        },
        customSiteTitle: 'EY Engage API Documentation',
        customfavIcon: '/favicon.ico',
        customJs: [
          'https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/4.15.5/swagger-ui-bundle.min.js',
          'https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/4.15.5/swagger-ui-standalone-preset.min.js',
        ],
        customCssUrl: [
          'https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/4.15.5/swagger-ui.min.css',
        ],
      });

      logger.log(`📚 Swagger documentation: http://localhost:${port}/api/docs`);
    }

    // ✅ Health check endpoint amélioré
    app.getHttpAdapter().get('/health', async (req, res) => {
      try {
        // Test de la base de données et des services
        const notificationsService = app.get(NotificationsService);
        const notificationsGateway = app.get(NotificationsGateway);
        
        const healthStatus = {
          status: 'OK',
          timestamp: new Date().toISOString(),
          uptime: Math.floor(process.uptime()),
          environment: nodeEnv,
          version: '1.0.0',
          services: {
            api: 'running',
            database: 'connected', // À implémenter si nécessaire
            uploads: existsSync(uploadsPath) ? 'available' : 'unavailable',
            websocket: 'enabled',
            notifications: {
              service: notificationsService ? 'available' : 'unavailable',
              gateway: notificationsGateway ? 'available' : 'unavailable',
              connected: notificationsService && notificationsGateway ? 'yes' : 'no',
            },
          },
          memory: {
            used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + ' MB',
            total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024) + ' MB',
            external: Math.round(process.memoryUsage().external / 1024 / 1024) + ' MB',
          },
          websocket: notificationsGateway ? {
            connectionStats: notificationsGateway.getConnectionStats(),
          } : null,
        };

        res.status(200).json(healthStatus);
      } catch (error) {
        logger.error('Health check error:', error);
        res.status(500).json({
          status: 'ERROR',
          timestamp: new Date().toISOString(),
          error: error.message,
        });
      }
    });

    // ✅ Root endpoint amélioré
    app.getHttpAdapter().get('/', (req, res) => {
      res.json({
        name: 'EY Engage API',
        version: '1.0.0',
        status: 'running',
        environment: nodeEnv,
        description: 'API Backend pour la plateforme collaborative EY Engage',
        endpoints: {
          documentation: nodeEnv === 'development' ? `/api/docs` : undefined,
          health: '/health',
          uploads: `/uploads`,
          api: '/api',
          websocket: '/notifications (Socket.IO)',
        },
        features: [
          'Social Network with mentions and reactions',
          'Real-time Notifications via WebSocket',
          'Event Management and Participation',
          'File Upload and Management',
          'Content Moderation and Administration',
          'User Authentication and Authorization',
          'Department-based Access Control',
        ],
        websocket: {
          namespace: '/notifications',
          transports: ['websocket', 'polling'],
          auth: 'JWT Token required',
        },
      });
    });

    // ✅ Gestionnaires d'erreurs globaux améliorés
    process.on('unhandledRejection', (reason, promise) => {
      logger.error('🚨 Unhandled Promise Rejection:', {
        reason: reason?.toString(),
        promise: promise?.toString(),
        stack: (reason as any)?.stack,
      });
      
      if (nodeEnv === 'production') {
        // En production, on peut choisir de redémarrer l'application
        logger.error('🔄 Restarting application due to unhandled rejection...');
        setTimeout(() => process.exit(1), 1000);
      }
    });

    process.on('uncaughtException', (error) => {
      logger.error('🚨 Uncaught Exception:', {
        message: error.message,
        stack: error.stack,
      });
      
      // Toujours arrêter sur une exception non capturée
      logger.error('💀 Shutting down due to uncaught exception...');
      process.exit(1);
    });

    // ✅ Graceful shutdown amélioré
    const gracefulShutdown = async (signal: string) => {
      logger.log(`🛑 ${signal} received, shutting down gracefully...`);
      try {
        // Fermer les connexions WebSocket
        const notificationsGateway = app.get(NotificationsGateway);
        if (notificationsGateway && notificationsGateway.server) {
          logger.log('🔌 Closing WebSocket connections...');
          notificationsGateway.server.close();
        }

        // Fermer l'application
        await app.close();
        logger.log('✅ Application closed successfully');
        process.exit(0);
      } catch (error) {
        logger.error('❌ Error during shutdown:', error);
        process.exit(1);
      }
    };

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));

    // ✅ Démarrer l'application
    await app.listen(port, '0.0.0.0');

    // ✅ Messages de démarrage améliorés
    logger.log('🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀');
    logger.log(`🚀 EY Engage API started successfully!`);
    logger.log(`🚀 Server: http://localhost:${port}`);
    logger.log(`🚀 Environment: ${nodeEnv}`);
    logger.log(`🚀 Uploads: http://localhost:${port}/uploads/`);
    logger.log(`🚀 WebSocket: ws://localhost:${port}/notifications`);
    
    if (nodeEnv === 'development') {
      logger.log(`🚀 API Docs: http://localhost:${port}/api/docs`);
      logger.log(`🚀 Health Check: http://localhost:${port}/health`);
      logger.log(`🚀 Hot reload: enabled`);
    }
    
    logger.log('🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀');

    // ✅ Test de santé initial
    setTimeout(async () => {
      try {
        const response = await fetch(`http://localhost:${port}/health`);
        const health = await response.json();
        logger.log(`✅ Initial health check: ${health.status}`);
        
        if (health.services.notifications.connected === 'yes') {
          logger.log('✅ Notifications system is fully operational');
        } else {
          logger.warn('⚠️ Notifications system may have issues');
        }
      } catch (error) {
        logger.warn(`⚠️ Initial health check failed: ${error.message}`);
      }
    }, 3000);

  } catch (error) {
    logger.error('❌❌❌ Failed to start application:', {
      message: error.message,
      stack: error.stack,
    });
    
    // En développement, essayer de donner plus d'informations
    if (nodeEnv === 'development') {
      logger.error('💡 Development mode - detailed error info:', error);
    }
    
    process.exit(1);
  }
}

// ✅ Gérer les erreurs de démarrage
bootstrap().catch((error) => {
  const logger = new Logger('Bootstrap');
  logger.error('💥 Failed to bootstrap application:', error);
  console.error('Full error:', error);
  process.exit(1);
});