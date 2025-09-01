import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../shared/guards/jwt-auth.guard';
import { CurrentUser } from '../shared/decorators/user.decorator';
import { IUser } from '../shared/interfaces/user.interface';

@Controller('auth')
export class AuthController {
  @Get('validate')
  @UseGuards(JwtAuthGuard)
  async validateToken(@CurrentUser() user: IUser) {
    return {
      success: true,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        department: user.department,
        roles: user.roles,
        isActive: user.isActive,
        profilePicture: user.profilePicture,
      },
    };
  }
}