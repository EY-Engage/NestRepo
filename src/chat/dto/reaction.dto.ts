import { IsUUID, IsEnum } from "class-validator";
import { Department } from "src/shared/enums/department.enum";
import { ReactionType } from "src/shared/enums/reaction-type.enum";

export class CreateMessageReactionDto {
  @IsUUID()
  messageId: string;

  @IsEnum(ReactionType)
  type: ReactionType;
}

export class MessageReactionDto {
  id: string;
  type: ReactionType;
  userId: string;
  userName: string;
  userProfilePicture?: string;
  userDepartment: Department;
  messageId: string;
  createdAt: Date;
}