import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ScheduleModule } from '@nestjs/schedule';
import { MulterModule } from '@nestjs/platform-express';
import { HttpModule } from '@nestjs/axios';
import { join } from 'path';
import { diskStorage } from 'multer';

// Configuration imports
import databaseConfig from './config/database.config';

// Module imports
import { AuthModule } from './auth/auth.module';
import { AdminModule } from './admin/admin.module';

// Shared imports
import { DatabaseModule } from './database/database.module';
import { ServeStaticModule } from '@nestjs/serve-static';
import jwtConfig from './config/jwt.config';

@Module({
  imports: [
    // Configuration
    ConfigModule.forRoot({
      isGlobal: true,
      load: [databaseConfig,jwtConfig ],
      envFilePath: ['.env.local', '.env'],
    }),

    // Database
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

    // File uploads
    MulterModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        storage: diskStorage({
          destination: (req, file, cb) => {
            let uploadPath = './uploads';
            
            // Organiser les uploads par type
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
          fileSize: parseInt(process.env.MAX_FILE_SIZE) || 5242880, // 5MB par défaut
        },
        fileFilter: (req, file, cb) => {
          const allowedTypes = (process.env.ALLOWED_FILE_TYPES || 'jpg,jpeg,png,gif,pdf,doc,docx').split(',');
          const fileExtension = file.originalname.split('.').pop()?.toLowerCase();
          
          if (allowedTypes.includes(fileExtension || '')) {
            cb(null, true);
          } else {
            cb(new Error(`Type de fichier non autorisé: ${fileExtension}`), false);
          }
        },
      }),
      inject: [ConfigService],
    }),

    // Static files serving
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', 'uploads'),
      serveRoot: '/uploads',
    }),

    // HTTP client
    HttpModule.register({
      timeout: 10000,
      maxRedirects: 3,
    }),

    // Task scheduling
    ScheduleModule.forRoot(),

    // Application modules
    DatabaseModule,
    AuthModule,
    AdminModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
