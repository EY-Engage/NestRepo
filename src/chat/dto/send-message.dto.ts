import { IsUUID, IsEnum, IsString, MinLength, MaxLength, IsOptional, IsArray, IsObject } from "class-validator";
import { MessageType } from "src/shared/enums/message-type.enum";
import { Transform } from "class-transformer";


export class SendMessageDto {
  @IsUUID()
  conversationId: string;

  @IsEnum(MessageType)
  type: MessageType;

  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  @Transform(({ value }) => value?.trim())
  content: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  attachments?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  mentions?: string[];

  @IsOptional()
  @IsUUID()
  replyToId?: string;

  @IsOptional()
  @IsObject()
  metadata?: {
    fileSize?: number;
    fileName?: string;
    mimeType?: string;
    duration?: number;
    coordinates?: { lat: number; lng: number };
    link?: { title: string; description: string; image: string; url: string };
  };
}

export class UpdateMessageDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  @Transform(({ value }) => value?.trim())
  content?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  mentions?: string[];
}