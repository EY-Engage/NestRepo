import { IsOptional, IsNumber, Min, Max, IsEnum, IsString, IsBoolean, IsUUID } from "class-validator";
import { ConversationType } from "src/shared/enums/conversation-type.enum";
import { Department } from "src/shared/enums/department.enum";
import { MessageType } from "src/shared/enums/message-type.enum";
import { Transform } from "class-transformer";

export class ChatQueryDto {
  @IsOptional()
  @Transform(({ value }) => parseInt(value))
  @IsNumber()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Transform(({ value }) => parseInt(value))
  @IsNumber()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @IsOptional()
  @IsEnum(ConversationType)
  type?: ConversationType;

  @IsOptional()
  @IsEnum(Department)
  department?: Department;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === 'true')
  unreadOnly?: boolean = false;

  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === 'true')
  activeOnly?: boolean = true;
}

export class MessageQueryDto {
  @IsOptional()
  @Transform(({ value }) => parseInt(value))
  @IsNumber()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Transform(({ value }) => parseInt(value))
  @IsNumber()
  @Min(1)
  @Max(100)
  limit?: number = 50;

  @IsOptional()
  @IsUUID()
  before?: string; // Message ID pour pagination curseur

  @IsOptional()
  @IsUUID()
  after?: string; // Message ID pour pagination curseur

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsEnum(MessageType)
  type?: MessageType;

  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === 'true')
  pinnedOnly?: boolean = false;
}
