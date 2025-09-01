import { registerAs } from '@nestjs/config';

export default registerAs('jwt', () => ({
  secret: process.env.JWT_SECRET,
  signOptions: {
    expiresIn: '15m',
    issuer:'http://localhost:5058',
    audience:'http://localhost:5058',
  },
  refreshExpiresIn:  '7d',
}));