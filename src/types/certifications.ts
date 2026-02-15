export interface Certification {
  id: string;
  type: string;
  issueDate?: string;
  expirationDate: string;
  notes?: string;
  employeeId: string;
  employeeName: string;
  createdAt?: string;
}

export interface CertConfig {
  id: string;
  name: string;
}
