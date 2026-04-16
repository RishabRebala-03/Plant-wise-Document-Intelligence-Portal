import type { DocumentRecord, Plant, User, UserRole } from "./types";

export type ProjectStatus = "Active" | "At Risk" | "Planned" | "Closed";

export interface ProjectRecord {
  id: string;
  plantId: string;
  plantName: string;
  name: string;
  code: string;
  description: string;
  owner: string;
  status: ProjectStatus;
  createdAt: string;
  dueDate: string | null;
  documentIds: string[];
  source: "derived" | "custom";
}

export interface AccessRule {
  role: UserRole;
  plantsScope: string;
  canCreateProjects: boolean;
  canUploadDocuments: boolean;
  canEditDocuments: boolean;
  canDeleteDocuments: boolean;
  canManageUsers: boolean;
  canConfigureIp: boolean;
}

export interface IpRule {
  id: string;
  label: string;
  address: string;
  status: "Allowed" | "Blocked" | "Review";
  lastUpdated: string;
}

export interface SessionPolicy {
  autoLogoutMinutes: number;
  conflictMode: "warn" | "block";
  enforceSingleSession: boolean;
}

export interface PortalState {
  projects: ProjectRecord[];
  accessRules: AccessRule[];
  ipRules: IpRule[];
  sessionPolicy: SessionPolicy;
  managerDocumentLocks: Record<string, string[]>;
  projectAssignments: Record<string, string>;
}

export type AccessCapability =
  | "canCreateProjects"
  | "canUploadDocuments"
  | "canEditDocuments"
  | "canDeleteDocuments"
  | "canManageUsers"
  | "canConfigureIp";

export interface EnrichedDocument extends DocumentRecord {
  projectId: string;
  projectName: string;
  identifier: string;
  managerName: string;
  accessLocked: boolean;
}

type LocalProjectDraft = Omit<ProjectRecord, "source">;

export const PORTAL_STATE_KEY = "midwest.portalState";

const PROJECT_TEMPLATES: Array<{
  id: string;
  name: string;
  code: string;
  description: string;
  categories: string[];
  status: ProjectStatus;
}> = [
  {
    id: "safety",
    name: "Safety and Compliance",
    code: "SAFE",
    description: "Audits, incidents, permits, and compliance reviews.",
    categories: ["Safety Report", "Environmental Compliance", "Incident Report", "Permit"],
    status: "Active",
  },
  {
    id: "ops",
    name: "Operations Reliability",
    code: "OPS",
    description: "Inspections, logs, and maintenance workstreams.",
    categories: ["Equipment Inspection", "Production Log", "Maintenance Record"],
    status: "Active",
  },
  {
    id: "special",
    name: "Strategic Initiatives",
    code: "STRAT",
    description: "Cross-functional documents and special programs.",
    categories: ["Other"],
    status: "Planned",
  },
];

const DEFAULT_ACCESS_RULES: AccessRule[] = [
  {
    role: "CEO",
    plantsScope: "All plants",
    canCreateProjects: false,
    canUploadDocuments: false,
    canEditDocuments: true,
    canDeleteDocuments: true,
    canManageUsers: true,
    canConfigureIp: false,
  },
  {
    role: "Mining Manager",
    plantsScope: "Assigned plant only",
    canCreateProjects: true,
    canUploadDocuments: true,
    canEditDocuments: false,
    canDeleteDocuments: false,
    canManageUsers: false,
    canConfigureIp: false,
  },
  {
    role: "Admin",
    plantsScope: "Governance view",
    canCreateProjects: false,
    canUploadDocuments: false,
    canEditDocuments: true,
    canDeleteDocuments: true,
    canManageUsers: true,
    canConfigureIp: true,
  },
];

const DEFAULT_IP_RULES: IpRule[] = [
  { id: "ip-1", label: "Corporate VPN", address: "10.18.4.0/24", status: "Allowed", lastUpdated: "2026-04-13" },
  { id: "ip-2", label: "Head Office Gateway", address: "172.16.10.44", status: "Allowed", lastUpdated: "2026-04-10" },
  { id: "ip-3", label: "Unknown Chicago ISP", address: "203.0.113.56", status: "Review", lastUpdated: "2026-04-14" },
  { id: "ip-4", label: "Blocked Public Endpoint", address: "198.51.100.72", status: "Blocked", lastUpdated: "2026-04-12" },
];

const DEFAULT_SESSION_POLICY: SessionPolicy = {
  autoLogoutMinutes: 2,
  conflictMode: "block",
  enforceSingleSession: true,
};

function buildDefaultProjects(plants: Plant[], documents: DocumentRecord[]): ProjectRecord[] {
  const projects: ProjectRecord[] = [];

  plants.forEach((plant) => {
    PROJECT_TEMPLATES.forEach((template, index) => {
      const projectId = `${plant.id}-${template.id}`;
      const assignedDocs = documents
        .filter((document) => document.plantId === plant.id)
        .filter((document) => template.categories.includes(document.category) || (template.id === "special" && !PROJECT_TEMPLATES[0].categories.concat(PROJECT_TEMPLATES[1].categories).includes(document.category)))
        .map((document) => document.id);

      const owner =
        plant.manager ||
        documents.find((document) => document.plantId === plant.id)?.uploadedBy ||
        "Unassigned";

      projects.push({
        id: projectId,
        plantId: plant.id,
        plantName: plant.name,
        name: template.name,
        code: `${template.code}-${plant.id.slice(-2)}${index + 1}`,
        description: template.description,
        owner,
        status: assignedDocs.length === 0 ? "Planned" : template.status,
        createdAt: plant.lastUpload || "2026-01-01",
        dueDate: null,
        documentIds: assignedDocs,
        source: "derived",
      });
    });
  });

  return projects;
}

export function defaultPortalState(plants: Plant[], documents: DocumentRecord[]): PortalState {
  return {
    projects: buildDefaultProjects(plants, documents),
    accessRules: DEFAULT_ACCESS_RULES,
    ipRules: DEFAULT_IP_RULES,
    sessionPolicy: DEFAULT_SESSION_POLICY,
    managerDocumentLocks: {},
    projectAssignments: {},
  };
}

export function readPortalState(plants: Plant[], documents: DocumentRecord[]): PortalState {
  const fallback = defaultPortalState(plants, documents);
  const raw = window.localStorage.getItem(PORTAL_STATE_KEY);
  if (!raw) return fallback;

  try {
    const parsed = JSON.parse(raw) as Partial<PortalState>;
    return {
      ...fallback,
      ...parsed,
      projects: [
        ...buildDefaultProjects(plants, documents),
        ...((parsed.projects || []) as LocalProjectDraft[]).map((project) => ({
          ...project,
          source: "custom" as const,
        })),
      ],
      accessRules: parsed.accessRules || fallback.accessRules,
      ipRules: parsed.ipRules || fallback.ipRules,
      sessionPolicy: parsed.sessionPolicy || fallback.sessionPolicy,
      managerDocumentLocks: parsed.managerDocumentLocks || {},
      projectAssignments: parsed.projectAssignments || {},
    };
  } catch {
    return fallback;
  }
}

export function persistPortalState(state: PortalState) {
  const payload: PortalState = {
    ...state,
    projects: state.projects.filter((project) => project.source === "custom"),
  };
  window.localStorage.setItem(PORTAL_STATE_KEY, JSON.stringify(payload));
}

export function createProject(
  state: PortalState,
  draft: Pick<ProjectRecord, "plantId" | "plantName" | "name" | "code" | "description" | "owner" | "dueDate">,
) {
  const project: ProjectRecord = {
    id: `custom-${Math.random().toString(36).slice(2, 9)}`,
    ...draft,
    createdAt: new Date().toISOString().slice(0, 10),
    status: "Active",
    documentIds: [],
    source: "custom",
  };

  return {
    ...state,
    projects: [...state.projects, project],
  };
}

export function updateAccessRules(state: PortalState, accessRules: AccessRule[]) {
  return {
    ...state,
    accessRules,
  };
}

export function getAccessRuleForRole(accessRules: AccessRule[], role: UserRole) {
  return accessRules.find((rule) => rule.role === role) || null;
}

export function hasAccessCapability(rule: AccessRule | null, capability: AccessCapability) {
  return Boolean(rule?.[capability]);
}

export function updateIpRules(state: PortalState, ipRules: IpRule[]) {
  return {
    ...state,
    ipRules,
  };
}

export function updateSessionPolicy(state: PortalState, sessionPolicy: SessionPolicy) {
  return {
    ...state,
    sessionPolicy,
  };
}

export function assignDocumentToProject(state: PortalState, documentId: string, projectId: string) {
  const projects = state.projects.map((project) => {
    const isTarget = project.id === projectId;
    const nextDocumentIds = project.documentIds.filter((id) => id !== documentId);
    return {
      ...project,
      documentIds: isTarget ? [...nextDocumentIds, documentId] : nextDocumentIds,
    };
  });

  return {
    ...state,
    projects,
    projectAssignments: {
      ...state.projectAssignments,
      [documentId]: projectId,
    },
  };
}

export function lockManagerDocument(state: PortalState, managerId: string, documentId: string) {
  const existing = state.managerDocumentLocks[managerId] || [];
  if (existing.includes(documentId)) return state;

  return {
    ...state,
    managerDocumentLocks: {
      ...state.managerDocumentLocks,
      [managerId]: [...existing, documentId],
    },
  };
}

export function enrichDocuments(
  documents: DocumentRecord[],
  projects: ProjectRecord[],
  currentUser: User | null,
  plants: Plant[],
  projectAssignments: Record<string, string> = {},
  filters?: {
    plantId?: string;
    projectId?: string;
    q?: string;
    manager?: string;
    dateFrom?: string;
    dateTo?: string;
    identifier?: string;
  },
) {
  const allowedPlantIds =
    currentUser?.role === "Mining Manager" && currentUser.plantId
      ? new Set([currentUser.plantId])
      : new Set(plants.map((plant) => plant.id));

  const enriched: EnrichedDocument[] = documents
    .filter((document) => allowedPlantIds.has(document.plantId))
    .map((document) => {
      const assignedProjectId = projectAssignments[document.id];
      const project =
        projects.find((candidate) => candidate.id === assignedProjectId) ||
        projects.find((candidate) => candidate.documentIds.includes(document.id)) ||
        projects.find((candidate) => candidate.plantId === document.plantId) || {
          id: "unassigned",
          name: "Unassigned",
          owner: document.uploadedBy,
        };

      return {
        ...document,
        projectId: project.id,
        projectName: project.name,
        managerName: project.owner,
        identifier: `${document.plantId}-${document.id}`,
        accessLocked: false,
      };
    });

  return enriched.filter((document) => {
    const matchesPlant = !filters?.plantId || document.plantId === filters.plantId;
    const matchesProject = !filters?.projectId || document.projectId === filters.projectId;
    const matchesManager =
      !filters?.manager || document.managerName.toLowerCase().includes(filters.manager.toLowerCase());
    const matchesIdentifier =
      !filters?.identifier || document.identifier.toLowerCase().includes(filters.identifier.toLowerCase());
    const query = filters?.q?.toLowerCase().trim();
    const matchesQuery =
      !query ||
      [
        document.name,
        document.plant,
        document.category,
        document.uploadedBy,
        document.projectName,
        document.identifier,
      ]
        .join(" ")
        .toLowerCase()
        .includes(query);
    const matchesFrom = !filters?.dateFrom || Boolean(document.date && document.date >= filters.dateFrom);
    const matchesTo = !filters?.dateTo || Boolean(document.date && document.date <= filters.dateTo);

    return matchesPlant && matchesProject && matchesManager && matchesIdentifier && matchesQuery && matchesFrom && matchesTo;
  });
}

export function withManagerLocks(documents: EnrichedDocument[], state: PortalState, currentUser: User | null) {
  if (!currentUser || currentUser.role !== "Mining Manager") return documents;
  const locked = new Set(state.managerDocumentLocks[currentUser.id] || []);
  return documents.map((document) => ({
    ...document,
    accessLocked: locked.has(document.id),
  }));
}

export function summarizeByPlant(documents: EnrichedDocument[]) {
  const summary = new Map<string, { plant: string; documents: number; locked: number; projects: Set<string> }>();

  documents.forEach((document) => {
    const current = summary.get(document.plantId) || {
      plant: document.plant,
      documents: 0,
      locked: 0,
      projects: new Set<string>(),
    };
    current.documents += 1;
    current.locked += document.accessLocked ? 1 : 0;
    current.projects.add(document.projectId);
    summary.set(document.plantId, current);
  });

  return Array.from(summary.entries()).map(([plantId, value]) => ({
    plantId,
    plant: value.plant,
    documents: value.documents,
    locked: value.locked,
    projects: value.projects.size,
  }));
}

export function formatRole(role: UserRole) {
  return role === "Mining Manager" ? "Manager" : role;
}
