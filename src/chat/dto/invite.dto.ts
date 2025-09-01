import { IsUUID, IsOptional, IsString, MaxLength, IsEnum } from "class-validator";
import { Department } from "src/shared/enums/department.enum";

export class CreateInviteDto {
  @IsUUID()
  conversationId: string;

  @IsUUID()
  invitedUserId: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  message?: string;

  @IsOptional()
  expiresAt?: Date;
}

export class RespondInviteDto {
  @IsUUID()
  inviteId: string;

  @IsEnum(['accepted', 'declined'])
  response: 'accepted' | 'declined';
}

export class InviteDto {
  id: string;
  conversationId: string;
  conversationName: string;
  invitedUserId: string;
  invitedUserName: string;
  invitedUserEmail: string;
  invitedById: string;
  invitedByName: string;
  invitedByDepartment: Department;
  status: 'pending' | 'accepted' | 'declined' | 'expired';
  message?: string;
  expiresAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  respondedAt?: Date;
}