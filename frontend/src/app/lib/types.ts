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

