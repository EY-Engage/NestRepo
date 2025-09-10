import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ScheduleModule } from '@nestjs/schedule';
import { MulterModule } from '@nestjs/platform-express';
import { HttpModule } from '@nestjs/axios';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import { diskStorage } from 'multer';

// Configuration
import databaseConfig from './config/database.config';
import jwtConfig from './config/jwt.config';

// Modules
import { DatabaseModule } from './database/database.module';
import { AuthModule } from './auth/auth.module';
import { PostsModule } from './social/posts/posts.module';
import { AdminModule } from './admin/admin.module';

@Module({
  imports: [
    // Configuration globale
    ConfigModule.forRoot({
      isGlobal: true,
      load: [databaseConfig, jwtConfig],
      envFilePath: ['.env.local', '.env'],
    }),

    // Base de données
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        ...configService.get('database'),
      }),
      inject: [ConfigService],
    }),

    // Authentication
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        secret: configService.get<string>('jwt.secret'),
        signOptions: configService.get('jwt.signOptions'),
      }),
      inject: [ConfigService],
    }),

    // Upload de fichiers
    MulterModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async () => ({
        storage: diskStorage({
          destination: (req, file, cb) => {
            let uploadPath = './uploads';
            
            if (file.fieldname === 'images') {
              uploadPath = './uploads/images';
            } else if (file.fieldname === 'files') {
              uploadPath = './uploads/files';
            } else if (file.fieldname === 'attachments') {
              uploadPath = './uploads/chat';
            } else if (file.fieldname === 'profilePicture') {
              uploadPath = './uploads/profiles';
            }

            cb(null, uploadPath);
          },
          filename: (req, file, cb) => {
            const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
            const extension = file.originalname.split('.').pop();
            cb(null, `${file.fieldname}-${uniqueSuffix}.${extension}`);
          },
        }),
        limits: {
          fileSize: 5 * 1024 * 1024, // 5MB
        },
      }),
      inject: [ConfigService],
    }),

    // Fichiers statiques
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', 'uploads'),
      serveRoot: '/uploads',
    }),

    // HTTP client
    HttpModule.register({
      timeout: 10000,
      maxRedirects: 3,
    }),

    // Planification de tâches
    ScheduleModule.forRoot(),

    // Modules de l'application
    DatabaseModule,
    AuthModule, // Module principal pour les notifications
    PostsModule,
    AdminModule,
  ],
})
export class AppModule {}