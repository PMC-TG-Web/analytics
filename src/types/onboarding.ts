export interface OnboardingSubmission {
  id?: string;
  // Personnel Info
  firstName: string;
  lastName: string;
  middleInitial?: string;
  ssn: string; // Encrypted or handled with care
  dateOfBirth: string;
  phone: string;
  email: string;
  address: {
    street: string;
    city: string;
    state: string;
    zip: string;
  };

  // Tax Info (W-4 based)
  taxFilingStatus: 'Single' | 'Married' | 'Head of Household';
  multipleJobsOrSpouseWorks: boolean;
  claimDependentsAmount?: number;
  otherIncomeAmount?: number;
  deductionsAmount?: number;
  extraWithholdingAmount?: number;

  // Dependents
  dependents?: {
    name: string;
    dateOfBirth: string;
    ssn: string;
    relationship: string;
  }[];

  // State Tax Info (PA specifically often needed)
  stateTaxExemptions?: number;

  // Direct Deposit
  bankName?: string;
  routingNumber?: string;
  accountNumber?: string;
  accountType?: 'Checking' | 'Savings';

  // Emergency Contacts
  emergencyContacts: {
    name: string;
    relationship: string;
    phone: string;
  }[];

  // Metadata
  submittedAt: string;
  status: 'pending' | 'processed' | 'completed';

  // Digital Signature & Audit Trail
  signatureName: string;
  signatureDate: string;
  ipAddress?: string;
  userAgent?: string;
}
