import { IsEnum, IsUUID } from "class-validator";
import { ContentType } from "src/shared/enums/content-type.enum";
import { Department } from "src/shared/enums/department.enum";
import { ReactionType } from "src/shared/enums/reaction-type.enum";


export class CreateReactionDto {
  @IsEnum(ReactionType)
  type: ReactionType;

  @IsUUID()
  targetId: string;

  @IsEnum(ContentType)
  targetType: ContentType;
}

export class ReactionDto {
  id: string;
  type: ReactionType;
  userId: string;
  userName: string;
  userProfilePicture?: string;
  userDepartment: Department;
  targetId: string;
  targetType: ContentType;
  createdAt: Date;
}
