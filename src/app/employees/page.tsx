"use client";

import { useEffect, useState } from "react";
import { collection, getDocs, doc, setDoc, deleteDoc } from "firebase/firestore";
import { db } from "@/firebase";
import ProtectedPage from "@/components/ProtectedPage";
import Navigation from "@/components/Navigation";

interface Employee {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  role: string;
  department?: string;
  hourlyRate?: number;
  isActive: boolean;
  hireDate?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
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

  // Form state
  const [formData, setFormData] = useState<Partial<Employee>>({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    role: "Field Worker",
    department: "",
    hourlyRate: 0,
    isActive: true,
    hireDate: "",
    notes: "",
  });

  useEffect(() => {
    loadEmployees();
  }, []);

  async function loadEmployees() {
    try {
      const snapshot = await getDocs(collection(db, "employees"));
      const employeeData = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      })) as Employee[];
      
      // Sort by last name, then first name
      employeeData.sort((a, b) => {
        const lastNameCompare = a.lastName.localeCompare(b.lastName);
        if (lastNameCompare !== 0) return lastNameCompare;
        return a.firstName.localeCompare(b.firstName);
      });
      
      setEmployees(employeeData);
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
      phone: "",
      role: "Field Worker",
      department: "",
      hourlyRate: 0,
      isActive: true,
      hireDate: new Date().toISOString().split('T')[0],
      notes: "",
    });
    setModalVisible(true);
  }

  function openEditModal(employee: Employee) {
    setEditingEmployee(employee);
    setFormData({
      firstName: employee.firstName,
      lastName: employee.lastName,
      email: employee.email,
      phone: employee.phone || "",
      role: employee.role,
      department: employee.department || "",
      hourlyRate: employee.hourlyRate || 0,
      isActive: employee.isActive,
      hireDate: employee.hireDate || "",
      notes: employee.notes || "",
    });
    setModalVisible(true);
  }

  async function saveEmployee() {
    if (!formData.firstName || !formData.lastName || !formData.email) {
      alert("Please fill in all required fields (First Name, Last Name, Email)");
      return;
    }

    setSaving(true);
    try {
      const now = new Date().toISOString();
      const employeeId = editingEmployee?.id || `emp_${Date.now()}`;
      
      const employeeData: Employee = {
        id: employeeId,
        firstName: formData.firstName!,
        lastName: formData.lastName!,
        email: formData.email!.toLowerCase(),
        phone: formData.phone || "",
        role: formData.role || "Field Worker",
        department: formData.department || "",
        hourlyRate: formData.hourlyRate || 0,
        isActive: formData.isActive ?? true,
        hireDate: formData.hireDate || "",
        notes: formData.notes || "",
        createdAt: editingEmployee?.createdAt || now,
        updatedAt: now,
      };

      await setDoc(doc(db, "employees", employeeId), employeeData);
      
      // Update local state
      if (editingEmployee) {
        setEmployees((prev) =>
          prev.map((emp) => (emp.id === employeeId ? employeeData : emp))
        );
      } else {
        setEmployees((prev) => [...prev, employeeData].sort((a, b) => {
          const lastNameCompare = a.lastName.localeCompare(b.lastName);
          if (lastNameCompare !== 0) return lastNameCompare;
          return a.firstName.localeCompare(b.firstName);
        }));
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

  async function deleteEmployee(employee: Employee) {
    if (!confirm(`Are you sure you want to delete ${employee.firstName} ${employee.lastName}?`)) {
      return;
    }

    try {
      await deleteDoc(doc(db, "employees", employee.id));
      setEmployees((prev) => prev.filter((emp) => emp.id !== employee.id));
    } catch (error) {
      console.error("Failed to delete employee:", error);
      alert("Failed to delete employee");
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
        emp.role.toLowerCase().includes(search) ||
        (emp.department && emp.department.toLowerCase().includes(search))
      );
    }

    return true;
  });

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
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-7xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Employee Management</h1>
            <p className="text-gray-600 mt-1">
              {activeCount} active, {inactiveCount} inactive • Total: {employees.length}
            </p>
          </div>
          <Navigation currentPage="employees" />
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

            <button
              onClick={openAddModal}
              className="px-6 py-2 bg-orange-600 text-white rounded-lg font-semibold hover:bg-orange-700 transition-colors"
            >
              + Add Employee
            </button>
          </div>
        </div>

        {/* Employee Table */}
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gradient-to-r from-teal-600 to-teal-700">
                <tr>
                  <th className="text-left py-4 px-4 text-sm font-bold text-white">Name</th>
                  <th className="text-left py-4 px-4 text-sm font-bold text-white">Email</th>
                  <th className="text-left py-4 px-4 text-sm font-bold text-white">Phone</th>
                  <th className="text-left py-4 px-4 text-sm font-bold text-white">Role</th>
                  <th className="text-left py-4 px-4 text-sm font-bold text-white">Department</th>
                  <th className="text-center py-4 px-4 text-sm font-bold text-white">Rate</th>
                  <th className="text-center py-4 px-4 text-sm font-bold text-white">Status</th>
                  <th className="text-center py-4 px-4 text-sm font-bold text-white">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredEmployees.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="text-center py-12 text-gray-500">
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
                      <td className="py-3 px-4 text-sm text-gray-600">{employee.phone || "—"}</td>
                      <td className="py-3 px-4 text-sm text-gray-600">{employee.role}</td>
                      <td className="py-3 px-4 text-sm text-gray-600">{employee.department || "—"}</td>
                      <td className="py-3 px-4 text-sm text-center font-semibold text-gray-900">
                        {employee.hourlyRate ? `$${employee.hourlyRate.toFixed(2)}/hr` : "—"}
                      </td>
                      <td className="py-3 px-4 text-center">
                        <span
                          className={`inline-block px-3 py-1 rounded-full text-xs font-semibold ${
                            employee.isActive
                              ? "bg-green-100 text-green-800"
                              : "bg-gray-100 text-gray-800"
                          }`}
                        >
                          {employee.isActive ? "Active" : "Inactive"}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-center">
                        <div className="flex gap-2 justify-center">
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
                    Email <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
                    placeholder="john.doe@pmcdecor.com"
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

                {/* Role */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Role
                  </label>
                  <select
                    value={formData.role}
                    onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
                  >
                    <option value="Field Worker">Field Worker</option>
                    <option value="Project Manager">Project Manager</option>
                    <option value="Superintendent">Superintendent</option>
                    <option value="Foreman">Foreman</option>
                    <option value="Estimator">Estimator</option>
                    <option value="Office Staff">Office Staff</option>
                    <option value="Executive">Executive</option>
                    <option value="Other">Other</option>
                  </select>
                </div>

                {/* Department */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Department
                  </label>
                  <input
                    type="text"
                    value={formData.department}
                    onChange={(e) => setFormData({ ...formData, department: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
                    placeholder="Construction"
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

                {/* Status */}
                <div className="col-span-2">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.isActive}
                      onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
                      className="w-5 h-5 text-teal-600 focus:ring-2 focus:ring-teal-500 rounded"
                    />
                    <span className="text-sm font-medium text-gray-700">Active Employee</span>
                  </label>
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
    </div>
  );
}
