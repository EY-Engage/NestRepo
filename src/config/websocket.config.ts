import { registerAs } from '@nestjs/config';

export default registerAs('websocket', () => ({
  cors: {
    origin: process.env.WS_CORS_ORIGIN || 'http://localhost:3000',
    credentials: true,
    methods: ['GET', 'POST'],
  },
  port: parseInt(process.env.WS_PORT) || 3001,
  namespace: {
    chat: '/chat',
    notifications: '/notifications',
    social: '/social',
    admin: '/admin',
  },
  adapter: {
    redis: {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT) || 6379,
      password: process.env.REDIS_PASSWORD,
    },
  },
  options: {
    transports: ['websocket', 'polling'],
    allowEIO3: true,
    pingTimeout: 60000,
    pingInterval: 25000,
    maxHttpBufferSize: 1e6,
    allowRequest: (req, callback) => {
      // Custom validation logic if needed
      callback(null, true);
    },
  },
}));