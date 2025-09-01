import { IsUUID, IsEnum, IsOptional, IsObject } from "class-validator";

export class WebSocketEventDto {
  event: string;
  data: any;
  timestamp: Date;
  userId?: string;
  conversationId?: string;
}

export class JoinRoomDto {
  @IsUUID()
  conversationId: string;
}

export class LeaveRoomDto {
  @IsUUID()
  conversationId: string;
}

export class MarkAsReadDto {
  @IsUUID()
  conversationId: string;

  @IsUUID()
  messageId: string;
}

export class VoiceCallDto {
  @IsUUID()
  conversationId: string;

  @IsEnum(['start', 'accept', 'decline', 'end'])
  action: 'start' | 'accept' | 'decline' | 'end';

  @IsOptional()
  @IsObject()
  callData?: {
    callId: string;
    type: 'voice' | 'video';
    participants: string[];
  };
}