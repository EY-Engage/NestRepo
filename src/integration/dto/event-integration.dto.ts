import { IsString, IsUUID, IsEnum, IsOptional, IsDate } from 'class-validator';
import { Transform } from 'class-transformer';
import { Department } from 'src/shared/enums/department.enum';
import { EventStatus } from 'src/shared/enums/event-status.enum';
import { ParticipationStatus } from 'src/shared/enums/participation-status.enum';

export class EventIntegrationDto {
  @IsUUID()
  id: string;

  @IsString()
  title: string;

  @IsString()
  description: string;

  @Transform(({ value }) => new Date(value))
  @IsDate()
  date: Date;

  @IsString()
  location: string;

  @IsUUID()
  organizerId: string;

  @IsString()
  organizerName: string;

  @IsEnum(Department)
  organizerDepartment: Department;

  @IsEnum(EventStatus)
  status: EventStatus;

  @IsOptional()
  @IsString()
  imagePath?: string;

  @IsOptional()
  @IsUUID()
  approvedById?: string;

  @IsOptional()
  @IsString()
  approvedByName?: string;
}

export class ParticipationIntegrationDto {
  @IsUUID()
  id: string;

  @IsUUID()
  eventId: string;

  @IsString()
  eventTitle: string;

  @IsUUID()
  userId: string;

  @IsString()
  userName: string;

  @IsString()
  userEmail: string;

  @IsEnum(ParticipationStatus)
  status: ParticipationStatus;

  @Transform(({ value }) => new Date(value))
  @IsDate()
  requestedAt: Date;

  @IsOptional()
  @Transform(({ value }) => value ? new Date(value) : undefined)
  @IsDate()
  decidedAt?: Date;

  @IsOptional()
  @IsUUID()
  approvedById?: string;

  @IsOptional()
  @IsString()
  approvedByName?: string;
}