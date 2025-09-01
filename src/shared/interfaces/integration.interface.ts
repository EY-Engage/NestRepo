import { ApplicationStatus } from "../enums/application-status.enum";
import { Department } from "../enums/department.enum";
import { EventStatus } from "../enums/event-status.enum";
import { JobType } from "../enums/job-type.enum";
import { ParticipationStatus } from "../enums/participation-status.enum";

export interface IEventIntegration {
  id: string;
  title: string;
  description: string;
  date: Date;
  location: string;
  organizerId: string;
  organizerName: string;
  organizerDepartment: Department;
  status: EventStatus;
  imagePath?: string;
}

export interface IJobIntegration {
  id: string;
  title: string;
  description: string;
  keySkills: string;
  experienceLevel: string;
  location: string;
  publisherId: string;
  publisherName: string;
  department: Department;
  jobType: JobType;
  isActive: boolean;
  publishDate: Date;
  closeDate?: Date;
}

export interface IParticipationIntegration {
  id: string;
  eventId: string;
  eventTitle: string;
  userId: string;
  userName: string;
  userEmail: string;
  status: ParticipationStatus;
  requestedAt: Date;
  decidedAt?: Date;
  approvedById?: string;
}

export interface IJobApplicationIntegration {
  id: string;
  jobOfferId: string;
  jobTitle: string;
  userId?: string;
  candidateName: string;
  candidateEmail: string;
  status: ApplicationStatus;
  appliedAt: Date;
  recommendedByUserId?: string;
  recommendedByName?: string;
}