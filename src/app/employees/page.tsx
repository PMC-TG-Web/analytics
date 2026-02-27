"use client";

import { useEffect, useState } from "react";

import { db, getDocs, collection, addDoc, setDoc, deleteDoc, doc, query, where } from "@/firebase";
import ProtectedPage from "@/components/ProtectedPage";
import Navigation from "@/components/Navigation";
import { Certification } from "@/types/certifications";

interface Employee {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  personalEmail?: string;
  phone?: string;
  workPhone?: string;
  jobTitle: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
  hourlyRate?: number;
  vacationHours?: number;
  keypadCode?: string;
  dateOfBirth?: string;
  hireDate?: string;
  dateOfLeave?: string;
  payHistory?: Array<{ date: string; rate: number }>;
  apparelRecords?: Array<{ type: string; size: string; dateReceived: string; count: number }>;
  isActive: boolean;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

interface TimeOffRequest {
  id: string;
  employeeId: string;
  startDate: string; // YYYY-MM-DD
  endDate: string;   // YYYY-MM-DD
  reason: string;
  type: "Vacation" | "Sick" | "Personal" | "Other" | "Company timeoff";
  hours?: number;     // Hours off per day
}

export default function EmployeesPage() {
  return (
    <ProtectedPage page="employees">
      <EmployeesContent />
    </ProtectedPage>
  );
}

function EmployeesContent() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterActive, setFilterActive] = useState<"all" | "active" | "inactive">("active");
  const [saving, setSaving] = useState(false);

  // Time off state
  const [timeOffModalVisible, setTimeOffModalVisible] = useState(false);
  const [selectedEmployeeForTimeOff, setSelectedEmployeeForTimeOff] = useState<Employee | null>(null);
  const [employeeTimeOffRequests, setEmployeeTimeOffRequests] = useState<TimeOffRequest[]>([]);
  const [newTimeOff, setNewTimeOff] = useState({
    startDate: "",
    endDate: "",
    reason: "",
    type: "Vacation" as const,
    hours: 10, // Default to full day
  });

  // Certification state
  const [certModalVisible, setCertModalVisible] = useState(false);
  const [selectedEmployeeForCert, setSelectedEmployeeForCert] = useState<Employee | null>(null);
  const [employeeCertifications, setEmployeeCertifications] = useState<Certification[]>([]);
  const [newCert, setNewCert] = useState({
    type: "",
    issueDate: "",
    expirationDate: "",
    notes: "",
  });

  // Download modal state
  const [downloadModalVisible, setDownloadModalVisible] = useState(false);
  const [includeInactiveEmployees, setIncludeInactiveEmployees] = useState(false);

  // Job titles state
  const [jobTitles, setJobTitles] = useState<string[]>([
    "Field Worker",
    "Project Manager",
    "Superintendent",
    "Foreman",
    "Estimator",
    "Office Staff",
    "Executive",
  ]);
  const [showAddJobTitle, setShowAddJobTitle] = useState(false);
  const [newJobTitle, setNewJobTitle] = useState("");

  // Form state
  const [formData, setFormData] = useState<Partial<Employee>>({
    firstName: "",
    lastName: "",
    email: "",
    personalEmail: "",
    phone: "",
    workPhone: "",
    jobTitle: "Field Worker",
    address: "",
    city: "",
    state: "",
    zip: "",
    country: "United States",
    hourlyRate: 0,
    vacationHours: 0,
    keypadCode: "",
    dateOfBirth: "",
    isActive: true,
    hireDate: "",
    dateOfLeave: "",
    notes: "",
    payHistory: [],
    apparelRecords: [],
  });

  useEffect(() => {
    loadEmployees();
    loadJobTitles();
  }, []);

  // Cache helpers
  const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes in milliseconds

  function getCachedData<T>(key: string): T | null {
    try {
      const cached = sessionStorage.getItem(key);
      if (!cached) return null;
      
      const { data, timestamp } = JSON.parse(cached);
      const now = Date.now();
      
      // Check if cache is still valid
      if (now - timestamp < CACHE_DURATION) {
        return data as T;
      }
      
      // Cache expired, remove it
      sessionStorage.removeItem(key);
      return null;
    } catch (error) {
      console.error("Error reading cache:", error);
      return null;
    }
  }

  function setCachedData<T>(key: string, data: T): void {
    try {
      const cacheObject = {
        data,
        timestamp: Date.now()
      };
      sessionStorage.setItem(key, JSON.stringify(cacheObject));
    } catch (error) {
      console.error("Error setting cache:", error);
    }
  }

  function invalidateCache(key: string): void {
    try {
      sessionStorage.removeItem(key);
    } catch (error) {
      console.error("Error invalidating cache:", error);
    }
  }

  function formatPhoneNumber(phone: string): string {
    if (!phone) return "";
    
    // Remove all non-digit characters
    const digits = phone.replace(/\D/g, "");
    
    // Remove leading 1 if present
    const cleanDigits = digits.startsWith("1") && digits.length === 11 ? digits.substring(1) : digits;
    
    // Format as (XXX) XXX-XXXX if we have 10 digits
    if (cleanDigits.length === 10) {
      return `(${cleanDigits.substring(0, 3)}) ${cleanDigits.substring(3, 6)}-${cleanDigits.substring(6)}`;
    }
    
    // Return original if not 10 digits
    return phone;
  }

  async function loadJobTitles() {
    try {
      // Try to get from cache first
      const cached = getCachedData<string[]>('jobTitles');
      if (cached) {
        setJobTitles(cached);
        return;
      }

      // Cache miss, fetch from Firestore
      const snapshot = await getDocs(collection(db, "jobTitles"));
      if (!snapshot.empty) {
        const titles = snapshot.docs.map((doc: any) => doc.data().title as string);
        const sortedTitles = titles.sort();
        setJobTitles(sortedTitles);
        setCachedData('jobTitles', sortedTitles);
      }
    } catch (error) {
      console.error("Error loading job titles:", error);
    }
  }

  async function addJobTitle() {
    if (!newJobTitle.trim()) return;
    
    const trimmedTitle = newJobTitle.trim();
    if (jobTitles.includes(trimmedTitle)) {
      alert("This job title already exists");
      return;
    }

    try {
      // Add to Firestore
      await addDoc(collection(db, "jobTitles"), {
        title: trimmedTitle,
        createdAt: new Date().toISOString()
      });
      
      // Update local state
      const newTitles = [...jobTitles, trimmedTitle].sort();
      setJobTitles(newTitles);
      setNewJobTitle("");
      setShowAddJobTitle(false);
      
      // Update form data to use the new title
      setFormData({ ...formData, jobTitle: trimmedTitle });
      
      // Invalidate and update cache
      setCachedData('jobTitles', newTitles);
    } catch (error) {
      console.error("Error adding job title:", error);
      alert("Failed to add job title");
    }
  }

  async function loadEmployees() {
    try {
      // Try to get from cache first
      const cached = getCachedData<Employee[]>('employees');
      if (cached) {
        setEmployees(cached);
        setLoading(false);
        return;
      }

      // Cache miss, fetch from Firestore
      const snapshot = await getDocs(collection(db, "employees"));
      const employeeData = snapshot.docs.map((doc: any) => {
        const data = doc.data() as any;
        // Migrate 'role' to 'jobTitle' if needed
        if (data.role && !data.jobTitle) {
          data.jobTitle = data.role;
        }
        return {
          id: doc.id,
          ...data,
        };
      }) as Employee[];
      
      // Sort by last name, then first name
      employeeData.sort((a, b) => {
        const lastNameCompare = a.lastName.localeCompare(b.lastName);
        if (lastNameCompare !== 0) return lastNameCompare;
        return a.firstName.localeCompare(b.firstName);
      });
      
      setEmployees(employeeData);
      setCachedData('employees', employeeData);
    } catch (error) {
      console.error("Failed to load employees:", error);
      alert("Failed to load employees");
    } finally {
      setLoading(false);
    }
  }

  function openAddModal() {
    setEditingEmployee(null);
    setFormData({
      firstName: "",
      lastName: "",
      email: "",
      personalEmail: "",
      phone: "",
      workPhone: "",
      jobTitle: "Field Worker",
      address: "",
      city: "",
      state: "",
      zip: "",
      country: "United States",
      hourlyRate: 0,
      vacationHours: 0,
      keypadCode: "",
      dateOfBirth: "",
      isActive: true,
      hireDate: new Date().toISOString().split('T')[0],
      dateOfLeave: "",
      notes: "",
      payHistory: [],
      apparelRecords: [],
    });
    setModalVisible(true);
  }

  function openEditModal(employee: Employee) {
    setEditingEmployee(employee);
    setFormData({
      firstName: employee.firstName || "",
      lastName: employee.lastName || "",
      email: employee.email || "",
      personalEmail: employee.personalEmail || "",
      phone: employee.phone || "",
      workPhone: employee.workPhone || "",
      jobTitle: employee.jobTitle,
      address: employee.address || "",
      city: employee.city || "",
      state: employee.state || "",
      zip: employee.zip || "",
      country: employee.country || "United States",
      hourlyRate: employee.hourlyRate || 0,
      vacationHours: employee.vacationHours || 0,
      keypadCode: employee.keypadCode || "",
      dateOfBirth: employee.dateOfBirth || "",
      isActive: employee.isActive,
      hireDate: employee.hireDate || "",
      dateOfLeave: employee.dateOfLeave || "",
      notes: employee.notes || "",
      payHistory: employee.payHistory || [],
      apparelRecords: employee.apparelRecords || [],
    });
    setModalVisible(true);
  }

  async function saveEmployee() {
    // Trim and validate required fields - handle both undefined and empty string
    const firstName = (formData.firstName || "").trim();
    const lastName = (formData.lastName || "").trim();
    
    if (!firstName || !lastName) {
      alert("Please fill in all required fields (First Name, Last Name)");
      return;
    }

    setSaving(true);
    try {
      const now = new Date().toISOString();
      const employeeId = editingEmployee?.id || `emp_${Date.now()}`;
      
      const employeeData: Employee = {
        id: employeeId,
        firstName: firstName,
        lastName: lastName,
        email: (formData.email || "").trim().toLowerCase(),
        personalEmail: formData.personalEmail || "",
        phone: formatPhoneNumber(formData.phone || ""),
        workPhone: formatPhoneNumber(formData.workPhone || ""),
        jobTitle: formData.jobTitle || "Field Worker",
        address: formData.address || "",
        city: formData.city || "",
        state: formData.state || "",
        zip: formData.zip || "",
        country: formData.country || "United States",
        hourlyRate: formData.hourlyRate || 0,
        vacationHours: formData.vacationHours || 0,
        keypadCode: formData.keypadCode || "",
        dateOfBirth: formData.dateOfBirth || "",
        isActive: formData.isActive ?? true,
        hireDate: formData.hireDate || "",
        dateOfLeave: formData.dateOfLeave || "",
        notes: formData.notes || "",
        payHistory: formData.payHistory || [],
        apparelRecords: formData.apparelRecords || [],
        createdAt: editingEmployee?.createdAt || now,
        updatedAt: now,
      };

      await setDoc(doc(db, "employees", employeeId), employeeData);
      
      // Update local state
      if (editingEmployee) {
        setEmployees((prev) => {
          const updated = prev.map((emp) => (emp.id === employeeId ? employeeData : emp));
          setCachedData('employees', updated);
          return updated;
        });
      } else {
        setEmployees((prev) => {
          const updated = [...prev, employeeData].sort((a, b) => {
            const lastNameCompare = a.lastName.localeCompare(b.lastName);
            if (lastNameCompare !== 0) return lastNameCompare;
            return a.firstName.localeCompare(b.firstName);
          });
          setCachedData('employees', updated);
          return updated;
        });
      }

      setModalVisible(false);
      setEditingEmployee(null);
    } catch (error) {
      console.error("Failed to save employee:", error);
      alert("Failed to save employee");
    } finally {
      setSaving(false);
    }
  }

  function handleDownloadReport() {
    setDownloadModalVisible(true);
  }

  function executeDownload() {
    const url = `/api/employees/export?includeInactive=${includeInactiveEmployees}`;
    window.location.href = url;
    setDownloadModalVisible(false);
    setIncludeInactiveEmployees(false);
  }

  async function deleteEmployee(employee: Employee) {
    if (!confirm(`Are you sure you want to delete ${employee.firstName} ${employee.lastName}?`)) {
      return;
    }

    try {
      await deleteDoc(doc(db, "employees", employee.id));
      setEmployees((prev) => {
        const updated = prev.filter((emp) => emp.id !== employee.id);
        setCachedData('employees', updated);
        return updated;
      });
    } catch (error) {
      console.error("Failed to delete employee:", error);
      alert("Failed to delete employee");
    }
  }

  async function toggleEmployeeStatus(employee: Employee) {
    const newStatus = !employee.isActive;
    try {
      const now = new Date().toISOString();
      const employeeData = { 
        ...employee, 
        isActive: newStatus,
        updatedAt: now 
      };
      await setDoc(doc(db, "employees", employee.id), employeeData);
      setEmployees((prev) => {
        const updated = prev.map((emp) => (emp.id === employee.id ? employeeData : emp));
        setCachedData('employees', updated);
        return updated;
      });
    } catch (error) {
      console.error("Failed to toggle status:", error);
      alert("Failed to update status");
    }
  }

  // Filter employees
  const filteredEmployees = employees.filter((emp) => {
    // Active filter
    if (filterActive === "active" && !emp.isActive) return false;
    if (filterActive === "inactive" && emp.isActive) return false;

    // Search filter
    if (searchTerm) {
      const search = searchTerm.toLowerCase();
      return (
        emp.firstName.toLowerCase().includes(search) ||
        emp.lastName.toLowerCase().includes(search) ||
        emp.email.toLowerCase().includes(search) ||
        emp.jobTitle.toLowerCase().includes(search)
      );
    }

    return true;
  });

  async function openTimeOffModal(employee: Employee) {
    setSelectedEmployeeForTimeOff(employee);
    setNewTimeOff({
      startDate: new Date().toISOString().split('T')[0],
      endDate: new Date().toISOString().split('T')[0],
      reason: "",
      type: "Vacation",
      hours: 10,
    });
    
    // Load existing time off for this employee
    try {
      const q = query(
        collection(db, "timeOffRequests"),
        where("employeeId", "==", employee.id)
      );
      const snapshot = await getDocs(q);
      const requests = snapshot.docs.map((doc: any) => ({
        id: doc.id,
        ...doc.data()
      })) as TimeOffRequest[];
      
      // Sort by start date desc
      requests.sort((a, b) => b.startDate.localeCompare(a.startDate));
      setEmployeeTimeOffRequests(requests);
      setTimeOffModalVisible(true);
    } catch (error) {
      console.error("Failed to load time off requests:", error);
      alert("Failed to load time off records");
    }
  }

  async function addTimeOff() {
    if (!selectedEmployeeForTimeOff) return;
    if (!newTimeOff.startDate || !newTimeOff.endDate) {
      alert("Please provide start and end dates");
      return;
    }

    setSaving(true);
    try {
      const docRef = await addDoc(collection(db, "timeOffRequests"), {
        employeeId: selectedEmployeeForTimeOff.id,
        startDate: newTimeOff.startDate,
        endDate: newTimeOff.endDate,
        reason: newTimeOff.reason,
        type: newTimeOff.type,
        hours: newTimeOff.hours,
        createdAt: new Date().toISOString(),
      });

      const newRequest: TimeOffRequest = {
        id: docRef.id,
        employeeId: selectedEmployeeForTimeOff.id,
        startDate: newTimeOff.startDate,
        endDate: newTimeOff.endDate,
        reason: newTimeOff.reason,
        type: newTimeOff.type,
        hours: newTimeOff.hours,
      };

      setEmployeeTimeOffRequests([newRequest, ...employeeTimeOffRequests]);
      setNewTimeOff({
        startDate: new Date().toISOString().split('T')[0],
        endDate: new Date().toISOString().split('T')[0],
        reason: "",
        type: "Vacation",
        hours: 10,
      });
    } catch (error) {
      console.error("Failed to add time off:", error);
      alert("Failed to save time off record");
    } finally {
      setSaving(false);
    }
  }

  async function deleteTimeOff(id: string) {
    if (!confirm("Are you sure you want to delete this time off record?")) return;
    
    try {
      await deleteDoc(doc(db, "timeOffRequests", id));
      setEmployeeTimeOffRequests(employeeTimeOffRequests.filter(r => r.id !== id));
    } catch (error) {
      console.error("Failed to delete time off:", error);
      alert("Failed to delete record");
    }
  }

  async function openCertModal(employee: Employee) {
    setSelectedEmployeeForCert(employee);
    setNewCert({
      type: "",
      issueDate: "",
      expirationDate: "",
      notes: "",
    });
    
    try {
      const q = query(
        collection(db, "certifications"),
        where("employeeId", "==", employee.id)
      );
      const snapshot = await getDocs(q);
      const certs = snapshot.docs.map((doc: any) => ({
        id: doc.id,
        ...doc.data()
      })) as Certification[];
      
      certs.sort((a, b) => b.expirationDate.localeCompare(a.expirationDate));
      setEmployeeCertifications(certs);
      setCertModalVisible(true);
    } catch (error) {
      console.error("Failed to load certifications:", error);
      alert("Failed to load certification records");
    }
  }

  async function addCert() {
    if (!selectedEmployeeForCert) return;
    if (!newCert.type || !newCert.expirationDate) {
      alert("Please provide certification type and expiration date");
      return;
    }

    setSaving(true);
    try {
      const certData = {
        employeeId: selectedEmployeeForCert.id,
        employeeName: `${selectedEmployeeForCert.firstName} ${selectedEmployeeForCert.lastName}`,
        type: newCert.type,
        issueDate: newCert.issueDate,
        expirationDate: newCert.expirationDate,
        notes: newCert.notes,
        createdAt: new Date().toISOString(),
      };

      const docRef = await addDoc(collection(db, "certifications"), certData);

      const createdCert: Certification = {
        id: docRef.id,
        ...certData
      };

      setEmployeeCertifications([createdCert, ...employeeCertifications]);
      setNewCert({
        type: "",
        issueDate: "",
        expirationDate: "",
        notes: "",
      });
    } catch (error) {
      console.error("Failed to add certification:", error);
      alert("Failed to save certification record");
    } finally {
      setSaving(false);
    }
  }

  async function deleteCert(id: string) {
    if (!confirm("Are you sure you want to delete this certification?")) return;
    
    try {
      await deleteDoc(doc(db, "certifications", id));
      setEmployeeCertifications(employeeCertifications.filter(c => c.id !== id));
    } catch (error) {
      console.error("Failed to delete certification:", error);
      alert("Failed to delete record");
    }
  }

  const activeCount = employees.filter((e) => e.isActive).length;
  const inactiveCount = employees.filter((e) => !e.isActive).length;

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 p-8">
        <div className="max-w-7xl mx-auto">
          <h1 className="text-3xl font-bold text-gray-900 mb-8">Employee Management</h1>
          <div className="text-center py-12">Loading employees...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-8 flex flex-col font-sans">
      <div className="max-w-7xl mx-auto w-full">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-8">
          <div>
            <h1 className="text-4xl font-black text-gray-950 uppercase tracking-tighter">Employees</h1>
            <p className="text-gray-500 font-bold uppercase text-[10px] tracking-widest mt-1 italic">
              {activeCount} active, {inactiveCount} inactive • Total: {employees.length}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <a 
              href="/onboarding/submissions" 
              className="px-6 py-3 bg-white border-2 border-teal-800 text-teal-800 font-black uppercase tracking-widest text-[10px] rounded-2xl hover:bg-teal-50 transition-all flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              Onboarding Submissions
            </a>
            <button 
              onClick={() => {
                setEditingEmployee(null);
                setFormData({
                  firstName: "",
                  lastName: "",
                  email: "",
                  phone: "",
                  jobTitle: "Field Worker",
                  hourlyRate: 0,
                  vacationHours: 0,
                  keypadCode: "",
                  dateOfBirth: "",
                  isActive: true,
                  hireDate: new Date().toISOString().split('T')[0],
                  dateOfLeave: "",
                  notes: "",
                  payHistory: [],
                  apparelRecords: [],
                });
                setModalVisible(true);
              }}
              className="px-6 py-3 bg-teal-800 text-white font-black uppercase tracking-widest text-[10px] rounded-2xl hover:bg-teal-900 transition-all shadow-lg shadow-teal-900/20 flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
              </svg>
              Add Employee
            </button>
            
            <button
              onClick={handleDownloadReport}
              className="px-6 py-3 bg-teal-50 text-teal-800 border-2 border-teal-200 font-black uppercase tracking-widest text-[10px] rounded-2xl hover:bg-teal-100 transition-all shadow-lg shadow-teal-900/10 flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              Download Report
            </button>
            
            <Navigation currentPage="employees" />
          </div>
        </div>

        {/* Controls */}
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <div className="flex flex-wrap gap-4 items-center justify-between">
            <div className="flex gap-4 items-center flex-1">
              <input
                type="text"
                placeholder="Search employees..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="flex-1 max-w-md px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
              
              <div className="flex gap-2">
                <button
                  onClick={() => setFilterActive("all")}
                  className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                    filterActive === "all"
                      ? "bg-teal-600 text-white"
                      : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                  }`}
                >
                  All ({employees.length})
                </button>
                <button
                  onClick={() => setFilterActive("active")}
                  className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                    filterActive === "active"
                      ? "bg-teal-600 text-white"
                      : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                  }`}
                >
                  Active ({activeCount})
                </button>
                <button
                  onClick={() => setFilterActive("inactive")}
                  className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                    filterActive === "inactive"
                      ? "bg-teal-600 text-white"
                      : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                  }`}
                >
                  Inactive ({inactiveCount})
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Employee Table */}
        <div className="bg-white rounded-[2rem] shadow-sm border border-gray-100 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-gray-950">
                  <th className="px-6 py-4 text-left text-[10px] font-black uppercase tracking-[0.2em] text-teal-400">Name</th>
                  <th className="px-6 py-4 text-left text-[10px] font-black uppercase tracking-[0.2em] text-teal-400">Email</th>
                  <th className="px-6 py-4 text-left text-[10px] font-black uppercase tracking-[0.2em] text-teal-400">Phone</th>
                  <th className="px-6 py-4 text-left text-[10px] font-black uppercase tracking-[0.2em] text-teal-400">Job Title</th>
                  <th className="px-6 py-4 text-center text-[10px] font-black uppercase tracking-[0.2em] text-teal-400">Rate</th>
                  <th className="px-6 py-4 text-center text-[10px] font-black uppercase tracking-[0.2em] text-teal-400">Status</th>
                  <th className="px-6 py-4 text-center text-[10px] font-black uppercase tracking-[0.2em] text-teal-400">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredEmployees.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="text-center py-12 text-gray-500">
                      {searchTerm
                        ? "No employees found matching your search"
                        : "No employees yet. Click 'Add Employee' to get started."}
                    </td>
                  </tr>
                ) : (
                  filteredEmployees.map((employee, idx) => (
                    <tr
                      key={employee.id}
                      className={`border-b border-gray-200 hover:bg-teal-50 ${
                        idx % 2 === 0 ? "bg-white" : "bg-gray-50"
                      }`}
                    >
                      <td className="py-3 px-4 text-sm font-medium text-gray-900">
                        {employee.firstName} {employee.lastName}
                      </td>
                      <td className="py-3 px-4 text-sm text-gray-600">{employee.email}</td>
                      <td className="py-3 px-4 text-sm text-gray-600">{formatPhoneNumber(employee.phone || "") || "—"}</td>
                      <td className="py-3 px-4 text-sm text-gray-600">{employee.jobTitle}</td>
                      <td className="py-3 px-4 text-sm text-center font-semibold text-gray-900">
                        {employee.hourlyRate ? `$${employee.hourlyRate.toFixed(2)}/hr` : "—"}
                      </td>
                      <td className="py-3 px-4 text-center">
                        <button
                          onClick={() => toggleEmployeeStatus(employee)}
                          className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors ${
                            employee.isActive
                              ? "bg-green-100 text-green-800 hover:bg-green-200"
                              : "bg-red-100 text-red-800 hover:bg-red-200"
                          }`}
                          title={`Click to set as ${employee.isActive ? 'Inactive' : 'Active'}`}
                        >
                          {employee.isActive ? "Active" : "Inactive"}
                        </button>
                      </td>
                      <td className="py-3 px-4 text-center">
                        <div className="flex gap-2 justify-center">
                          <button
                            onClick={() => openCertModal(employee)}
                            className="px-3 py-1 bg-teal-800 text-white text-xs rounded hover:bg-teal-900 transition-colors font-black uppercase tracking-tighter"
                          >
                            Certs
                          </button>
                          <button
                            onClick={() => openTimeOffModal(employee)}
                            className="px-3 py-1 bg-amber-600 text-white text-xs rounded hover:bg-amber-700 transition-colors font-medium"
                          >
                            Time Off
                          </button>
                          <button
                            onClick={() => openEditModal(employee)}
                            className="px-3 py-1 bg-teal-600 text-white text-xs rounded hover:bg-teal-700 transition-colors font-medium"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => deleteEmployee(employee)}
                            className="px-3 py-1 bg-red-600 text-white text-xs rounded hover:bg-red-700 transition-colors font-medium"
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Add/Edit Employee Modal */}
      {modalVisible && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
          onClick={() => setModalVisible(false)}
        >
          <div
            className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-6">
              <h2 className="text-2xl font-bold text-gray-900 mb-6">
                {editingEmployee ? "Edit Employee" : "Add New Employee"}
              </h2>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* First Name */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    First Name <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={formData.firstName}
                    onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
                    placeholder="John"
                  />
                </div>

                {/* Last Name */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Last Name <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={formData.lastName}
                    onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
                    placeholder="Doe"
                  />
                </div>

                {/* Email */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Email
                  </label>
                  <input
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
                    placeholder="john.doe@pmcdecor.com"
                  />
                </div>

                {/* Personal Email */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Personal Email
                  </label>
                  <input
                    type="email"
                    value={formData.personalEmail || ""}
                    onChange={(e) => setFormData({ ...formData, personalEmail: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
                    placeholder="john.doe@gmail.com"
                  />
                </div>

                {/* Phone */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Phone
                  </label>
                  <input
                    type="tel"
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
                    placeholder="(555) 123-4567"
                  />
                </div>

                {/* Work Phone */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Work Phone
                  </label>
                  <input
                    type="tel"
                    value={formData.workPhone || ""}
                    onChange={(e) => setFormData({ ...formData, workPhone: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
                    placeholder="(717) 000-0000"
                  />
                </div>

                {/* Job Title */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Job Title
                  </label>
                  <div className="flex gap-2">
                    <select
                      value={formData.jobTitle}
                      onChange={(e) => setFormData({ ...formData, jobTitle: e.target.value })}
                      className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
                    >
                      {jobTitles.map(title => (
                        <option key={title} value={title}>{title}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => setShowAddJobTitle(!showAddJobTitle)}
                      className="px-3 py-2 bg-teal-500 text-white rounded-lg hover:bg-teal-600 transition-colors text-sm font-medium"
                      title="Add new job title"
                    >
                      +
                    </button>
                  </div>
                  {showAddJobTitle && (
                    <div className="mt-2 flex gap-2">
                      <input
                        type="text"
                        value={newJobTitle}
                        onChange={(e) => setNewJobTitle(e.target.value)}
                        onKeyPress={(e) => e.key === 'Enter' && addJobTitle()}
                        placeholder="Enter new job title"
                        className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 text-sm"
                      />
                      <button
                        type="button"
                        onClick={addJobTitle}
                        className="px-3 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors text-sm font-medium"
                      >
                        Add
                      </button>
                      <button
                        type="button"
                        onClick={() => { setShowAddJobTitle(false); setNewJobTitle(""); }}
                        className="px-3 py-2 bg-gray-300 text-gray-700 rounded-lg hover:bg-gray-400 transition-colors text-sm font-medium"
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </div>

                {/* Address */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Address
                  </label>
                  <input
                    type="text"
                    value={formData.address || ""}
                    onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
                    placeholder="123 Main St"
                  />
                </div>

                {/* City */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    City
                  </label>
                  <input
                    type="text"
                    value={formData.city || ""}
                    onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
                    placeholder="Lancaster"
                  />
                </div>

                {/* State */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    State
                  </label>
                  <input
                    type="text"
                    value={formData.state || ""}
                    onChange={(e) => setFormData({ ...formData, state: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
                    placeholder="Pennsylvania"
                  />
                </div>

                {/* Zip */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Zip Code
                  </label>
                  <input
                    type="text"
                    value={formData.zip || ""}
                    onChange={(e) => setFormData({ ...formData, zip: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
                    placeholder="17527"
                  />
                </div>

                {/* Country */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Country
                  </label>
                  <input
                    type="text"
                    value={formData.country || "United States"}
                    onChange={(e) => setFormData({ ...formData, country: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
                    placeholder="United States"
                  />
                </div>

                {/* Hourly Rate */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Hourly Rate
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={formData.hourlyRate}
                    onChange={(e) => setFormData({ ...formData, hourlyRate: parseFloat(e.target.value) || 0 })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
                    placeholder="25.00"
                  />
                </div>

                {/* Vacation Hours */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Vacation Hours
                  </label>
                  <input
                    type="number"
                    step="0.5"
                    min="0"
                    value={formData.vacationHours || 0}
                    onChange={(e) => setFormData({ ...formData, vacationHours: parseFloat(e.target.value) || 0 })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
                    placeholder="40"
                  />
                </div>

                {/* Keypad Code */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Keypad Code
                  </label>
                  <input
                    type="text"
                    value={formData.keypadCode || ""}
                    onChange={(e) => setFormData({ ...formData, keypadCode: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
                    placeholder="1234"
                  />
                </div>

                {/* Date of Birth */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Date of Birth
                  </label>
                  <input
                    type="date"
                    value={formData.dateOfBirth || ""}
                    onChange={(e) => setFormData({ ...formData, dateOfBirth: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
                  />
                </div>

                {/* Hire Date */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Hire Date
                  </label>
                  <input
                    type="date"
                    value={formData.hireDate}
                    onChange={(e) => setFormData({ ...formData, hireDate: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
                  />
                </div>

                {/* Date of Leave */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Date of Leave
                  </label>
                  <input
                    type="date"
                    value={formData.dateOfLeave || ""}
                    onChange={(e) => setFormData({ ...formData, dateOfLeave: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
                  />
                </div>

                {/* Status */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Status
                  </label>
                  <select
                    value={formData.isActive ? "active" : "inactive"}
                    onChange={(e) => setFormData({ ...formData, isActive: e.target.value === "active" })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
                  >
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </div>

                {/* Notes */}
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Notes
                  </label>
                  <textarea
                    value={formData.notes}
                    onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                    rows={3}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
                    placeholder="Additional information..."
                  />
                </div>
              </div>

              {/* Modal Actions */}
              <div className="flex gap-3 justify-end mt-6 pt-6 border-t">
                <button
                  onClick={() => setModalVisible(false)}
                  className="px-6 py-2 bg-gray-200 text-gray-700 rounded-lg font-medium hover:bg-gray-300 transition-colors"
                  disabled={saving}
                >
                  Cancel
                </button>
                <button
                  onClick={saveEmployee}
                  disabled={saving}
                  className="px-6 py-2 bg-teal-600 text-white rounded-lg font-medium hover:bg-teal-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {saving ? "Saving..." : editingEmployee ? "Update Employee" : "Add Employee"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Time Off Modal */}
      {timeOffModalVisible && selectedEmployeeForTimeOff && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
          onClick={() => setTimeOffModalVisible(false)}
        >
          <div
            className="bg-white rounded-lg shadow-xl max-w-3xl w-full max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-6">
              <div className="flex justify-between items-center mb-6 border-b pb-4">
                <h2 className="text-2xl font-bold text-gray-900">
                  Time Off: {selectedEmployeeForTimeOff.firstName} {selectedEmployeeForTimeOff.lastName}
                </h2>
                <button 
                  onClick={() => setTimeOffModalVisible(false)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* Add New Time Off Form */}
              <div className="bg-amber-50 rounded-xl p-4 border border-amber-100 mb-8">
                <h3 className="text-sm font-black uppercase tracking-widest text-amber-800 mb-4 italic">Log New Time Off</h3>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
                  <div>
                    <label className="block text-[10px] font-black uppercase text-amber-900/50 mb-1">Start Date</label>
                    <input
                      type="date"
                      value={newTimeOff.startDate}
                      onChange={(e) => setNewTimeOff({ ...newTimeOff, startDate: e.target.value })}
                      className="w-full px-3 py-2 border-2 border-amber-200 rounded-xl focus:ring-0 focus:border-amber-500 outline-none text-sm font-bold"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-black uppercase text-amber-900/50 mb-1">End Date</label>
                    <input
                      type="date"
                      value={newTimeOff.endDate}
                      onChange={(e) => setNewTimeOff({ ...newTimeOff, endDate: e.target.value })}
                      className="w-full px-3 py-2 border-2 border-amber-200 rounded-xl focus:ring-0 focus:border-amber-500 outline-none text-sm font-bold"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-black uppercase text-amber-900/50 mb-1">Type</label>
                    <select
                      value={newTimeOff.type}
                      onChange={(e) => setNewTimeOff({ ...newTimeOff, type: e.target.value as any })}
                      className="w-full px-3 py-2 border-2 border-amber-200 rounded-xl focus:ring-0 focus:border-amber-500 outline-none text-sm font-bold"
                    >
                      <option value="Vacation">Vacation</option>
                      <option value="Sick">Sick</option>
                      <option value="Personal">Personal</option>
                      <option value="Company timeoff">Company timeoff</option>
                      <option value="Other">Other</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-black uppercase text-amber-900/50 mb-1">Hours / Day</label>
                    <input
                      type="number"
                      step="0.5"
                      min="0"
                      max="10"
                      value={newTimeOff.hours}
                      onChange={(e) => setNewTimeOff({ ...newTimeOff, hours: parseFloat(e.target.value) || 0 })}
                      className="w-full px-3 py-2 border-2 border-amber-200 rounded-xl focus:ring-0 focus:border-amber-500 outline-none text-sm font-bold"
                    />
                  </div>
                  <button
                    onClick={addTimeOff}
                    disabled={saving}
                    className="w-full bg-amber-600 text-white font-black uppercase text-[10px] tracking-widest py-3 rounded-xl hover:bg-amber-700 transition-colors disabled:opacity-50"
                  >
                    {saving ? "SAVING..." : "ADD TIME OFF"}
                  </button>
                  <div className="md:col-span-4">
                    <label className="block text-[10px] font-black uppercase text-amber-900/50 mb-1">Reason/Notes (Optional)</label>
                    <input
                      type="text"
                      placeholder="Family trip, appointment, etc."
                      value={newTimeOff.reason}
                      onChange={(e) => setNewTimeOff({ ...newTimeOff, reason: e.target.value })}
                      className="w-full px-3 py-2 border-2 border-amber-200 rounded-xl focus:ring-0 focus:border-amber-500 outline-none text-sm font-bold"
                    />
                  </div>
                </div>
              </div>

              {/* Existing Time Off List */}
              <div>
                <h3 className="text-xs font-black uppercase tracking-widest text-gray-400 mb-4 italic">Request History</h3>
                <div className="space-y-2">
                  {employeeTimeOffRequests.length === 0 ? (
                    <div className="text-center py-8 text-gray-400 text-xs italic bg-gray-50 rounded-xl border border-dashed border-gray-200">
                      No time off history found for this employee
                    </div>
                  ) : (
                    employeeTimeOffRequests.map((request) => (
                      <div key={request.id} className="flex items-center justify-between p-4 bg-white border border-gray-100 rounded-xl hover:shadow-sm transition-all group">
                        <div className="flex items-center gap-4">
                          <div className="bg-gray-50 px-3 py-1 rounded-lg border border-gray-100 flex flex-col items-center justify-center min-w-[100px]">
                            <span className="text-[10px] font-black text-gray-400 uppercase leading-tight">Dates</span>
                            <span className="text-xs font-black text-gray-700 leading-tight">
                              {new Date(request.startDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} 
                              - {new Date(request.endDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                            </span>
                          </div>
                          <div>
                            <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-full ${
                              request.type === 'Vacation' ? 'bg-blue-100 text-blue-700' :
                              request.type === 'Sick' ? 'bg-red-100 text-red-700' :
                              request.type === 'Company timeoff' ? 'bg-orange-100 text-orange-700' :
                              'bg-purple-100 text-purple-700'
                            }`}>
                              {request.type}
                            </span>
                            <span className="ml-2 text-[10px] font-bold text-gray-400">
                              ({request.hours || 10}h per day)
                            </span>
                            {request.reason && (
                              <p className="text-xs font-medium text-gray-500 mt-1">{request.reason}</p>
                            )}
                          </div>
                        </div>
                        <button
                          onClick={() => deleteTimeOff(request.id)}
                          className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-600 text-xs font-black uppercase tracking-tighter p-2 transition-all"
                        >
                          DELETE
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Certification Modal */}
      {certModalVisible && selectedEmployeeForCert && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
            <div className="bg-teal-800 p-6 flex justify-between items-center shrink-0">
              <div>
                <h2 className="text-xl font-black text-white uppercase tracking-tighter">Certification Management</h2>
                <p className="text-teal-200 text-xs font-bold">{selectedEmployeeForCert.firstName} {selectedEmployeeForCert.lastName}</p>
              </div>
              <button 
                onClick={() => setCertModalVisible(false)}
                className="text-white/70 hover:text-white transition-colors"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="p-8 overflow-y-auto custom-scrollbar">
              {/* New Certification Form */}
              <div className="bg-teal-50 rounded-2xl p-6 mb-8 border border-teal-200 shadow-sm">
                <h3 className="text-xs font-black uppercase tracking-widest text-teal-900 mb-4 flex items-center gap-2 italic">
                  <span className="w-2 h-2 bg-teal-600 rounded-full animate-pulse"></span>
                  Log New Certification
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <div className="md:col-span-2">
                    <label className="block text-[10px] font-black uppercase text-teal-950 mb-1">Certification Type</label>
                    <input
                      type="text"
                      placeholder="OSHA 30, Forklift, CPR, etc."
                      value={newCert.type}
                      onChange={(e) => setNewCert({ ...newCert, type: e.target.value })}
                      className="w-full px-3 py-2 border-2 border-teal-200 rounded-xl focus:ring-0 focus:border-teal-500 outline-none text-sm font-bold text-teal-950 placeholder:text-teal-300"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-black uppercase text-teal-950 mb-1">Issue Date (Opt)</label>
                    <input
                      type="date"
                      value={newCert.issueDate}
                      onChange={(e) => setNewCert({ ...newCert, issueDate: e.target.value })}
                      className="w-full px-3 py-2 border-2 border-teal-200 rounded-xl focus:ring-0 focus:border-teal-500 outline-none text-sm font-bold text-teal-950"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-black uppercase text-teal-950 mb-1">Expiration Date</label>
                    <input
                      type="date"
                      value={newCert.expirationDate}
                      onChange={(e) => setNewCert({ ...newCert, expirationDate: e.target.value })}
                      className="w-full px-3 py-2 border-2 border-teal-200 rounded-xl focus:ring-0 focus:border-teal-500 outline-none text-sm font-bold text-teal-950"
                    />
                  </div>
                  <div className="md:col-span-3">
                    <label className="block text-[10px] font-black uppercase text-teal-950 mb-1">Notes (Optional)</label>
                    <input
                      type="text"
                      value={newCert.notes}
                      onChange={(e) => setNewCert({ ...newCert, notes: e.target.value })}
                      className="w-full px-3 py-2 border-2 border-teal-200 rounded-xl focus:ring-0 focus:border-teal-500 outline-none text-sm font-bold text-teal-950 placeholder:text-teal-300"
                    />
                  </div>
                  <div className="flex items-end">
                    <button
                      onClick={addCert}
                      disabled={saving}
                      className="w-full bg-teal-600 text-white font-black uppercase text-[10px] tracking-widest py-3 rounded-xl hover:bg-teal-700 transition-colors disabled:opacity-50"
                    >
                      {saving ? "SAVING..." : "ADD CERT"}
                    </button>
                  </div>
                </div>
              </div>

              {/* Existing Certifications List */}
              <div>
                <h3 className="text-xs font-black uppercase tracking-widest text-gray-700 mb-4 italic">Certification History</h3>
                <div className="space-y-2">
                  {employeeCertifications.length === 0 ? (
                    <div className="text-center py-8 text-gray-600 text-xs italic bg-gray-50 rounded-xl border border-dashed border-gray-200">
                      No certifications on file for this employee
                    </div>
                  ) : (
                    employeeCertifications.map((cert) => {
                      const isExpired = cert.expirationDate && new Date(cert.expirationDate) < new Date();
                      return (
                        <div key={cert.id} className="flex items-center justify-between p-4 bg-white border border-gray-100 rounded-xl hover:shadow-md transition-all group">
                          <div className="flex items-center gap-4">
                            <div className={`px-3 py-1 rounded-lg border flex flex-col items-center justify-center min-w-[100px] ${
                              isExpired ? 'bg-red-50 border-red-200 shadow-sm shadow-red-100' : 'bg-green-50 border-green-200 shadow-sm shadow-green-100'
                            }`}>
                              <span className={`text-[10px] font-black uppercase leading-tight ${
                                isExpired ? 'text-red-600' : 'text-green-600'
                              }`}>Expires</span>
                              <span className={`text-sm font-black leading-tight ${
                                isExpired ? 'text-red-900' : 'text-green-900'
                              }`}>
                                {cert.expirationDate}
                              </span>
                            </div>
                            <div>
                              <span className="text-sm font-black text-gray-950 uppercase tracking-tight">{cert.type}</span>
                              <div className="flex items-center gap-2 mt-1">
                                {cert.issueDate && (
                                  <span className="text-[10px] font-black text-gray-600 uppercase">Issued: {cert.issueDate}</span>
                                )}
                                {cert.notes && (
                                  <span className="text-[10px] font-bold text-gray-700 italic border-l-2 border-gray-300 pl-2 ml-1">— {cert.notes}</span>
                                )}
                              </div>
                            </div>
                          </div>
                          <button
                            onClick={() => deleteCert(cert.id)}
                            className="opacity-0 group-hover:opacity-100 text-red-300 hover:text-red-600 text-[10px] font-black uppercase tracking-tighter p-2 transition-all"
                          >
                            REMOVE
                          </button>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Download Modal */}
      {downloadModalVisible && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full">
            <div className="p-6">
              <h2 className="text-2xl font-black text-gray-900 mb-4">Download Employee Report</h2>
              
              <div className="mb-6">
                <p className="text-gray-600 mb-4">
                  Choose your export options:
                </p>
                
                <label className="flex items-center space-x-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={includeInactiveEmployees}
                    onChange={(e) => setIncludeInactiveEmployees(e.target.checked)}
                    className="w-5 h-5 text-teal-600 border-gray-300 rounded focus:ring-teal-500 cursor-pointer"
                  />
                  <span className="text-gray-700 font-medium">
                    Include inactive employees
                  </span>
                </label>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => {
                    setDownloadModalVisible(false);
                    setIncludeInactiveEmployees(false);
                  }}
                  className="flex-1 px-4 py-2 bg-gray-100 text-gray-700 font-semibold rounded-lg hover:bg-gray-200 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={executeDownload}
                  className="flex-1 px-4 py-2 bg-teal-600 text-white font-semibold rounded-lg hover:bg-teal-700 transition-colors"
                >
                  Download
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
