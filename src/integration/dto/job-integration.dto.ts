import { IsUUID, IsString, IsEnum, IsBoolean, IsDate, IsOptional } from "class-validator";
import { Transform } from "class-transformer"; // Correction de l'import
import { ApplicationStatus } from "src/shared/enums/application-status.enum";
import { Department } from "src/shared/enums/department.enum";
import { JobType } from "src/shared/enums/job-type.enum";


export class JobIntegrationDto {
  @IsUUID()
  id: string;

  @IsString()
  title: string;

  @IsString()
  description: string;

  @IsString()
  keySkills: string;

  @IsString()
  experienceLevel: string;

  @IsString()
  location: string;

  @IsUUID()
  publisherId: string;

  @IsString()
  publisherName: string;

  @IsEnum(Department)
  department: Department;

  @IsEnum(JobType)
  jobType: JobType;

  @IsBoolean()
  isActive: boolean;

  @Transform(({ value }) => new Date(value))
  @IsDate()
  publishDate: Date;

  @IsOptional()
  @Transform(({ value }) => (value ? new Date(value) : undefined))
  @IsDate()
  closeDate?: Date;
}

export class JobApplicationIntegrationDto {
  @IsUUID()
  id: string;

  @IsUUID()
  jobOfferId: string;

  @IsString()
  jobTitle: string;

  @IsOptional()
  @IsUUID()
  userId?: string;

  @IsString()
  candidateName: string;

  @IsString()
  candidateEmail: string;

  @IsEnum(ApplicationStatus)
  status: ApplicationStatus;

  @Transform(({ value }) => new Date(value))
  @IsDate()
  appliedAt: Date;

  @IsOptional()
  @IsUUID()
  recommendedByUserId?: string;

  @IsOptional()
  @IsString()
  recommendedByName?: string;

  @IsOptional()
  @IsEnum(Department) // Correction du type
  jobDepartment?: Department;
}

export class InterviewScheduleDto {
  @IsUUID()
  applicationId: string;

  @IsUUID()
  jobId: string;

  @IsString()
  jobTitle: string;

  @IsUUID()
  candidateId: string;

  @IsString()
  candidateName: string;

  @IsString()
  candidateEmail: string;

  @Transform(({ value }) => new Date(value))
  @IsDate()
  interviewDate: Date;

  @IsString()
  location: string;
}