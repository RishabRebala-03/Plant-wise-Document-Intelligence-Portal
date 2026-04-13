export const plants = [
  { id: "P001", name: "Plant Alpha – Bloomington", company: "Midwest Ltd", documents: 142, lastUpload: "2026-04-08" },
  { id: "P002", name: "Plant Beta – Springfield", company: "Midwest Ltd", documents: 98, lastUpload: "2026-04-07" },
  { id: "P003", name: "Plant Gamma – Decatur", company: "Midwest Ltd", documents: 67, lastUpload: "2026-04-05" },
  { id: "P004", name: "Plant Delta – Peoria", company: "Midwest Ltd", documents: 53, lastUpload: "2026-03-29" },
  { id: "P005", name: "Plant Epsilon – Rockford", company: "Midwest Ltd", documents: 31, lastUpload: "2026-04-10" },
];

export const categories = [
  "Safety Report", "Environmental Compliance", "Equipment Inspection",
  "Production Log", "Incident Report", "Maintenance Record", "Permit", "Other"
];

export type CeoComment = {
  id: string;
  text: string;
  date: string;
  visibility: "private" | "public";
  author: string;
};

export const documents = [
  {
    id: "D001",
    name: "Q1 Safety Audit Report",
    plant: "Plant Alpha – Bloomington",
    category: "Safety Report",
    uploadedBy: "John Carter",
    date: "2026-04-08",
    version: 2,
    uploadComment: "Q1 mandatory audit – all sections reviewed and signed off.",
  },
  {
    id: "D002",
    name: "Environmental Impact Assessment",
    plant: "Plant Beta – Springfield",
    category: "Environmental Compliance",
    uploadedBy: "Sarah Miller",
    date: "2026-04-07",
    version: 1,
    uploadComment: "Annual EIA submission for regulatory filing.",
  },
  {
    id: "D003",
    name: "Conveyor Belt Inspection – March",
    plant: "Plant Gamma – Decatur",
    category: "Equipment Inspection",
    uploadedBy: "John Carter",
    date: "2026-04-05",
    version: 1,
    uploadComment: "Routine monthly inspection – minor wear noted on belt #3.",
  },
  {
    id: "D004",
    name: "Production Log – Week 14",
    plant: "Plant Alpha – Bloomington",
    category: "Production Log",
    uploadedBy: "Mike Reynolds",
    date: "2026-04-04",
    version: 1,
    uploadComment: "Weekly production metrics, targets met at 98%.",
  },
  {
    id: "D005",
    name: "Incident Report – Near Miss #47",
    plant: "Plant Delta – Peoria",
    category: "Incident Report",
    uploadedBy: "Sarah Miller",
    date: "2026-04-03",
    version: 1,
    uploadComment: "Near miss during shift change. Full RCA attached.",
  },
  {
    id: "D006",
    name: "Crusher Maintenance Log",
    plant: "Plant Epsilon – Rockford",
    category: "Maintenance Record",
    uploadedBy: "John Carter",
    date: "2026-04-10",
    version: 3,
    uploadComment: "Third revision following replacement of crusher jaw plates.",
  },
  {
    id: "D007",
    name: "Mining Permit Renewal 2026",
    plant: "Plant Beta – Springfield",
    category: "Permit",
    uploadedBy: "Admin User",
    date: "2026-04-01",
    version: 1,
    uploadComment: "Annual permit renewal submitted to state authority.",
  },
  {
    id: "D008",
    name: "Blasting Safety Protocol v4",
    plant: "Plant Alpha – Bloomington",
    category: "Safety Report",
    uploadedBy: "Mike Reynolds",
    date: "2026-03-30",
    version: 4,
    uploadComment: "Updated protocol with new exclusion zone distances.",
  },
  {
    id: "D009",
    name: "Water Discharge Compliance",
    plant: "Plant Gamma – Decatur",
    category: "Environmental Compliance",
    uploadedBy: "Sarah Miller",
    date: "2026-03-28",
    version: 2,
    uploadComment: "Revised after Q4 regulatory feedback.",
  },
  {
    id: "D010",
    name: "Heavy Equipment Check – Loader #3",
    plant: "Plant Delta – Peoria",
    category: "Equipment Inspection",
    uploadedBy: "John Carter",
    date: "2026-03-25",
    version: 1,
    uploadComment: "Pre-shift equipment inspection log for Loader #3.",
  },
];

export const initialCeoComments: Record<string, CeoComment[]> = {
  "D001": [
    { id: "CC001", text: "Reviewed – no issues found. Approved for board filing.", date: "2026-04-09", visibility: "private", author: "David Richardson" },
    { id: "CC002", text: "Share summary with shareholders in Q1 report.", date: "2026-04-09", visibility: "public", author: "David Richardson" },
  ],
  "D002": [
    { id: "CC003", text: "EIA looks thorough. Good work by Springfield team.", date: "2026-04-08", visibility: "public", author: "David Richardson" },
  ],
  "D005": [
    { id: "CC004", text: "Serious concern – follow up directly with site manager for RCA completion.", date: "2026-04-05", visibility: "private", author: "David Richardson" },
    { id: "CC005", text: "Escalate to HSE committee for review.", date: "2026-04-06", visibility: "private", author: "David Richardson" },
  ],
  "D008": [
    { id: "CC006", text: "Protocol update is approved. Communicate to all blasting crews.", date: "2026-04-01", visibility: "public", author: "David Richardson" },
  ],
};

export const users = [
  { id: "U001", name: "David Richardson", role: "CEO", email: "d.richardson@midwestltd.com", status: "Active", plant: "All" },
  { id: "U002", name: "John Carter", role: "Mining Manager", email: "j.carter@midwestltd.com", status: "Active", plant: "Plant Alpha – Bloomington" },
  { id: "U003", name: "Sarah Miller", role: "Mining Manager", email: "s.miller@midwestltd.com", status: "Active", plant: "Plant Beta – Springfield" },
  { id: "U004", name: "Mike Reynolds", role: "Mining Manager", email: "m.reynolds@midwestltd.com", status: "Active", plant: "Plant Alpha – Bloomington" },
  { id: "U005", name: "Admin User", role: "Admin", email: "admin@midwestltd.com", status: "Active", plant: "All" },
  { id: "U006", name: "Tom Bradley", role: "Mining Manager", email: "t.bradley@midwestltd.com", status: "Disabled", plant: "Plant Gamma – Decatur" },
];
