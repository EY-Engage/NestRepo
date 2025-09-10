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
      logger: ['error', 'warn', 'log', 'debug'],
    });

    const configService = app.get(ConfigService);
    const port = configService.get<number>('PORT') || 3001;
    const nodeEnv = configService.get<string>('NODE_ENV') || 'development';


    // Créer les dossiers d'upload
    const uploadsPath = join(process.cwd(), 'uploads');
    if (!existsSync(uploadsPath)) {
      mkdirSync(uploadsPath, { recursive: true });
    }

    const subFolders = ['images', 'files', 'profiles', 'chat'];
    subFolders.forEach(folder => {
      const folderPath = join(uploadsPath, folder);
      if (!existsSync(folderPath)) {
        mkdirSync(folderPath, { recursive: true });
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

    app.use(compression());
    app.use(cookieParser());

    // Servir les fichiers statiques
    app.use('/uploads', express.static(uploadsPath, {
      maxAge: nodeEnv === 'production' ? '1d' : '0',
    }));

    // CORS
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

    // Validation globale
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: false,
        transform: true,
        transformOptions: {
          enableImplicitConversion: true,
        },
      }),
    );

    // Préfixe API
    app.setGlobalPrefix('api', {
      exclude: ['/health', '/', '/uploads'],
    });

    // Swagger en développement
    if (nodeEnv === 'development') {
      const config = new DocumentBuilder()
        .setTitle('EY Engage API')
        .setDescription('API pour EY Engage - Social, Events, Notifications')
        .setVersion('1.0.0')
        .addBearerAuth()
        .build();

      const document = SwaggerModule.createDocument(app, config);
      SwaggerModule.setup('api/docs', app, document);
    }

    // Health check
    app.getHttpAdapter().get('/health', (req, res) => {
      res.json({
        status: 'OK',
        timestamp: new Date().toISOString(),
        uptime: Math.floor(process.uptime()),
        environment: nodeEnv,
        services: {
          api: 'running',
          websocket: 'enabled',
          uploads: 'available',
        },
      });
    });

    // Root endpoint
    app.getHttpAdapter().get('/', (req, res) => {
      res.json({
        name: 'EY Engage API',
        version: '1.0.0',
        status: 'running',
        environment: nodeEnv,
        endpoints: {
          documentation: nodeEnv === 'development' ? '/api/docs' : undefined,
          health: '/health',
          api: '/api',
          websocket: '/notifications',
        },
      });
    });

    // Démarrer l'application
    await app.listen(port, '0.0.0.0');

    logger.log('🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀');
    logger.log(`🚀 EY Engage API started successfully!`);
    logger.log(`🚀 Server: http://localhost:${port}`);
    logger.log(`🚀 Environment: ${nodeEnv}`);
    
    if (nodeEnv === 'development') {
      logger.log(`🚀 API Docs: http://localhost:${port}/api/docs`);
      logger.log(`🚀 Health Check: http://localhost:${port}/health`);
    }
    
    logger.log('🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀');

  } catch (error) {
    logger.error('❌ Failed to start application:', error);
    process.exit(1);
  }
}

bootstrap();