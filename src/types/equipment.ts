export interface Equipment {
  id: string;
  name: string;
  type: string; // e.g., "Truck", "Excavator", "Generator", "Tool"
  model?: string;
  make?: string;
  serialNumber?: string;
  status: "Available" | "In Use" | "Maintenance" | "Out of Service";
  hourlyRate?: number;
  dailyRate?: number;
  notes?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface EquipmentAssignment {
  id: string;
  equipmentId: string;
  equipmentName: string;
  projectId: string; // Firestore ID
  projectName: string;
  jobKey: string;
  startDate: string; // YYYY-MM-DD
  endDate: string;   // YYYY-MM-DD
  notes?: string;
  assignedBy?: string;
  createdAt: string;
}
