export interface EmailMetadata {
  id: string;
  emailId: string;
  from: string;
  to: string;
  subject: string;
  receivedDate: string;
  status: EmailStatus;
  lastResponseBy: string | null;
  preview: string;
  fullContent?: string;
  attachments?: EmailAttachment[];
}

export interface EmailAttachment {
  filename: string;
  contentType: string;
  size: number;
}

export interface DetailedEmail {
  emailId: string;
  from?: string;
  to?: string;
  subject?: string;
  preview?: string;
  fullContent?: string;
  receivedDate?: string;
  attachments?: EmailAttachment[];
}

export type EmailStatus = 'necesitaAtencion' | 'informativo' | 'respondido';

export interface SyncStats {
  processedCount: number;
  totalCount: number;
  newEmails: number;
  errors: number;
  inProgress: boolean;
  startTime: Date;
  endTime?: Date;
  lastUpdated: Date;
}

export interface StrapiConfig {
  graphqlUrl: string;
  apiToken: string;
}

export interface ImapConfig {
  user: string;
  password: string;
  host: string;
  port: number;
  tls: boolean;
  authTimeout: number;
  tlsOptions: {
    rejectUnauthorized: boolean;
  };
} 