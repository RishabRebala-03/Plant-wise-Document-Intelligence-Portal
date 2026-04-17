export type UserRole = "CEO" | "Mining Manager" | "Admin";

export interface User {
  id: string;
  name: string;
  firstName?: string;
  lastName?: string;
  email: string;
  role: UserRole;
  status: string;
  plant?: string;
  plantId?: string | null;
  assignedPlantIds?: string[];
  assignedPlants?: string[];
  notificationPreferences?: Record<string, boolean>;
  accessRule?: {
    role?: UserRole;
    plantsScope?: string;
    canCreateProjects?: boolean;
    canUploadDocuments?: boolean;
    canEditDocuments?: boolean;
    canDeleteDocuments?: boolean;
    canManageUsers?: boolean;
    canConfigureIp?: boolean;
  };
  capabilities?: {
    canCreateProjects?: boolean;
    canUploadDocuments?: boolean;
    canEditDocuments?: boolean;
    canDeleteDocuments?: boolean;
    canManageUsers?: boolean;
    canConfigureIp?: boolean;
  };
  displayPreferences?: {
    table_density?: string;
    language?: string;
    date_format?: string;
  } | Record<string, string>;
  security?: {
    twoFactorEnabled?: boolean;
    lastPasswordChangeAt?: string | null;
  };
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface Comment {
  id: string;
  documentId: string;
  text: string;
  visibility: "private" | "public";
  author: string;
  authorId: string;
  role?: string;
  date: string | null;
  updatedAt?: string | null;
}

export interface DocumentConversationMessage {
  id: string;
  documentId: string;
  authorId: string;
  authorName: string;
  authorRole: UserRole;
  audience: "workspace" | "executive" | "uploader";
  text: string;
  mentions: string[];
  mentionIds: string[];
  attachments: string[];
  createdAt: string | null;
  updatedAt?: string | null;
}

export interface MessageThread {
  id: string;
  title?: string | null;
  kind: "direct" | "group";
  participants: Array<{ id: string; name: string; role: UserRole }>;
  participantIds: string[];
  linkedDocuments: Array<{ id: string; name: string; plant?: string | null; category?: string | null }>;
  lastMessagePreview?: string | null;
  lastMessageAt: string | null;
  createdAt: string | null;
  updatedAt?: string | null;
  unread: boolean;
  unreadCount: number;
}

export interface MessageEntry {
  id: string;
  threadId: string;
  authorId: string;
  authorName: string;
  authorRole: UserRole;
  text: string;
  linkedDocuments: Array<{ id: string; name: string; plant?: string | null; category?: string | null }>;
  recipientCount: number;
  readByCount: number;
  readByNames: string[];
  receiptStatus?: "sent" | "delivered" | "read" | null;
  lastReadAt?: string | null;
  createdAt: string | null;
  updatedAt?: string | null;
}

export interface DocumentFile {
  name?: string | null;
  contentType?: string | null;
  sizeBytes?: number | null;
  storageId?: string | null;
}

export interface DocumentRecord {
  id: string;
  name: string;
  plant: string;
  plantId: string;
  category: string;
  uploadedBy: string;
  uploadedById: string;
  date: string | null;
  version: number;
  uploadComment?: string | null;
  status: string;
  company?: string;
  file?: DocumentFile;
  noteSummary?: {
    count: number;
    latest: Comment | null;
  };
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface NotificationItem {
  id: string;
  userId: string;
  title: string;
  detail: string;
  href: string;
  documentId?: string;
  type: string;
  read: boolean;
  createdAt: string | null;
  readAt?: string | null;
}

export interface SessionRecord {
  sessionId: string;
  userId: string;
  userName?: string | null;
  userEmail?: string | null;
  userRole?: string | null;
  clientIp: string;
  userAgent?: string | null;
  browser?: string | null;
  device?: string | null;
  startedAt: string | null;
  lastSeenAt: string | null;
  endedAt: string | null;
  durationSeconds: number;
  idleSeconds: number;
  status: "Active" | "Ended";
  revokedReason?: string | null;
}

export interface OutsideHoursAttempt {
  id: string;
  userId?: string | null;
  userName?: string | null;
  userRole?: string | null;
  clientIp: string;
  occurredAt: string | null;
  detail?: string | null;
  browser?: string | null;
  device?: string | null;
  userAgent?: string | null;
  status?: string | null;
}

export interface GovernancePolicy {
  allowedUploadFormats: string[];
  businessHours: {
    timezone: string;
    startHour: number;
    endHour: number;
    allowedDays: number[];
  };
}

export interface Plant {
  id: string;
  name: string;
  company: string;
  documents: number;
  lastUpload: string | null;
  status: string;
  manager?: string | null;
  location?: string | null;
  capacity?: string | null;
  recentDocuments?: DocumentRecord[];
}

export interface Activity {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  documentId?: string;
  documentName?: string;
  userId?: string;
  userName?: string;
  metadata?: Record<string, unknown>;
  createdAt: string | null;
}

export interface CeoDashboardData {
  kpis: {
    totalDocuments: number;
    activePlants: number;
    recentUploads: number;
    categories: number;
  };
  alerts: { type: string; text: string; link: string }[];
  plants: Plant[];
  recentDocuments: DocumentRecord[];
}

export interface ManagerDashboardData {
  stats: {
    myDocuments: number;
    uploadedThisWeek: number;
    approved: number;
  };
  recentUploads: DocumentRecord[];
  activity: Activity[];
}

export interface AnalyticsData {
  summary: {
    totalUploads: number;
    monthlyAverage: number;
    peakMonth: { month: string | null; uploads: number };
    topPlant: { id?: string; name: string | null; documents: number };
  };
  monthlyUploads: { month: string; uploads: number }[];
  categoryDistribution: { category: string; count: number; pct: number; color: string }[];
  topUploaders: { name: string; docs: number; plants: string }[];
  plantVolume: { id: string; name: string; documents: number; lastUpload: string | null }[];
}
