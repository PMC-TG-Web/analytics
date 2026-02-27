"use client";

import { useState, useEffect } from "react";

import { db, getDocs, setDoc, doc, collection, getDoc } from "@/firebase";
import ProtectedPage from "@/components/ProtectedPage";

interface Employee {
  id: string;
  firstName: string;
  lastName: string;
  jobTitle: string;
  email: string;
  isActive: boolean;
}

interface CrewAssignment {
  foremanId: string;
  rightHandManId?: string;
  crewMemberIds: string[];
}

export default function CrewManagementPage() {
  return (
    <ProtectedPage page="crew-management">
      <CrewManagementContent />
    </ProtectedPage>
  );
}

function CrewManagementContent() {
  const [foremen, setForemen] = useState<Employee[]>([]);
  const [rightHandMen, setRightHandMen] = useState<Employee[]>([]);
  const [laborers, setLaborers] = useState<Employee[]>([]);
  const [crewAssignments, setCrewAssignments] = useState<Record<string, CrewAssignment>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [searchTerms, setSearchTerms] = useState<Record<string, string>>({});

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      setLoading(true);
      
      // Load employees
      const employeesSnapshot = await getDocs(collection(db, "employees"));
      const allEmployees = employeesSnapshot.docs.map((doc: any) => ({
        id: doc.id,
        ...doc.data()
      } as Employee));

      // Filter by job title
      const foremenList = allEmployees.filter((emp: any) => 
        emp.isActive && (
          emp.jobTitle === "Foreman" || 
          emp.jobTitle === "Forman" || 
          emp.jobTitle === "Lead Foreman" || 
          emp.jobTitle === "Lead foreman" || 
          emp.jobTitle === "Lead Foreman / Project Manager"
        )
      ).sort((a: any, b: any) => a.lastName.localeCompare(b.lastName));

      const rightHandMenList = allEmployees.filter((emp: any) => 
        emp.isActive && (
          emp.jobTitle?.includes("Right Hand Man") || 
          emp.jobTitle?.includes("Right Hand")
        )
      ).sort((a: any, b: any) => a.lastName.localeCompare(b.lastName));

      const laborersList = allEmployees.filter((emp: any) => 
        emp.isActive && emp.jobTitle === "Laborer"
      ).sort((a: any, b: any) => a.lastName.localeCompare(b.lastName));

      setForemen(foremenList);
      setRightHandMen(rightHandMenList);
      setLaborers(laborersList);

      // Load crew assignments
      const assignments: Record<string, CrewAssignment> = {};
      for (const foreman of foremenList) {
        const crewDoc = await getDoc(doc(db, "crews", foreman.id));
        if (crewDoc.exists()) {
          assignments[foreman.id] = crewDoc.data() as CrewAssignment;
        } else {
          assignments[foreman.id] = {
            foremanId: foreman.id,
            crewMemberIds: []
          };
        }
      }

      setCrewAssignments(assignments);
    } catch (error) {
      console.error("Error loading data:", error);
      alert("Failed to load crew data");
    } finally {
      setLoading(false);
    }
  }

  async function saveCrewAssignment(foremanId: string) {
    try {
      setSaving(foremanId);
      const assignment = crewAssignments[foremanId];
      
      // Clean up undefined values for Firestore
      const dataToSave: any = {
        foremanId: assignment.foremanId,
        crewMemberIds: assignment.crewMemberIds || []
      };
      
      // Only add rightHandManId if it exists and is not empty
      if (assignment.rightHandManId) {
        dataToSave.rightHandManId = assignment.rightHandManId;
      }
      
      await setDoc(doc(db, "crews", foremanId), dataToSave);
      
      alert("Crew assignment saved successfully!");
    } catch (error) {
      console.error("Error saving crew assignment:", error);
      alert("Failed to save crew assignment");
    } finally {
      setSaving(null);
    }
  }

  function updateRightHandMan(foremanId: string, rightHandManId: string) {
    setCrewAssignments(prev => ({
      ...prev,
      [foremanId]: {
        ...prev[foremanId],
        rightHandManId: rightHandManId || undefined
      }
    }));
  }

  function toggleCrewMember(foremanId: string, laborerId: string) {
    setCrewAssignments(prev => {
      const current = prev[foremanId]?.crewMemberIds || [];
      const newMembers = current.includes(laborerId)
        ? current.filter(id => id !== laborerId)
        : [...current, laborerId];
      
      return {
        ...prev,
        [foremanId]: {
          ...prev[foremanId],
          foremanId,
          crewMemberIds: newMembers
        }
      };
    });
  }

  function getEmployeeName(employeeId: string): string {
    const employee = [...rightHandMen, ...laborers].find(e => e.id === employeeId);
    return employee ? `${employee.firstName} ${employee.lastName}` : "";
  }

  function getFilteredLaborers(foremanId: string): Employee[] {
    const search = searchTerms[foremanId]?.toLowerCase() || "";
    
    // Get all laborers assigned to OTHER foremen
    const assignedToOthers = new Set<string>();
    Object.entries(crewAssignments).forEach(([fid, assignment]) => {
      if (fid !== foremanId) {
        assignment.crewMemberIds?.forEach((laborerId: any) => assignedToOthers.add(laborerId));
      }
    });
    
    // Filter out laborers assigned to other crews
    let availableLaborers = laborers.filter((laborer: any) => !assignedToOthers.has(laborer.id));
    
    // Apply search filter
    if (search) {
      availableLaborers = availableLaborers.filter((laborer: any) => 
        `${laborer.firstName} ${laborer.lastName}`.toLowerCase().includes(search)
      );
    }
    
    return availableLaborers;
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading crew data...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-7xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Crew Management</h1>
          <p className="text-gray-600 mt-2">Assign right hand men and crew members to foremen</p>
        </div>

        {foremen.length === 0 ? (
          <div className="bg-white rounded-lg shadow p-8 text-center">
            <p className="text-gray-600">No foremen found</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
            {foremen.map((foreman: any) => {
              const assignment = crewAssignments[foreman.id] || { foremanId: foreman.id, crewMemberIds: [] };
              const assignedLaborers = assignment.crewMemberIds || [];
              const filteredLaborers = getFilteredLaborers(foreman.id);

              return (
                <div key={foreman.id} className="bg-white rounded-lg shadow-md overflow-hidden flex flex-col">
                  <div className="bg-blue-600 text-white px-4 py-3">
                    <h2 className="text-lg font-bold">
                      {foreman.firstName} {foreman.lastName}
                    </h2>
                    <p className="text-blue-100 text-xs">{foreman.jobTitle}</p>
                  </div>

                  <div className="p-4 flex-1 flex flex-col">
                    {/* Right Hand Man Selection */}
                    <div className="mb-3">
                      <label className="block text-xs font-semibold text-gray-700 mb-1">
                        Right Hand Man
                      </label>
                      <select
                        value={assignment.rightHandManId || ""}
                        onChange={(e) => updateRightHandMan(foreman.id, e.target.value)}
                        className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        <option value="">-- None --</option>
                        {rightHandMen.map((rhm: any) => (
                          <option key={rhm.id} value={rhm.id}>
                            {rhm.firstName} {rhm.lastName}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Crew Members Count */}
                    <div className="mb-3">
                      <div className="bg-gray-100 rounded-lg px-3 py-2">
                        <p className="text-xs font-semibold text-gray-700">Crew Size</p>
                        <p className="text-xl font-bold text-blue-600">
                          {assignedLaborers.length}
                        </p>
                      </div>
                    </div>

                    {/* Crew Members Selection */}
                    <div className="flex-1 flex flex-col">
                      <label className="block text-xs font-semibold text-gray-700 mb-1">
                        Laborers
                      </label>
                      
                      {/* Search */}
                      <input
                        type="text"
                        placeholder="Search..."
                        value={searchTerms[foreman.id] || ""}
                        onChange={(e) => setSearchTerms(prev => ({ ...prev, [foreman.id]: e.target.value }))}
                        className="w-full px-2 py-1.5 text-sm mb-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />

                      {/* Selected members */}
                      {assignedLaborers.length > 0 && (
                        <div className="mb-2 flex flex-wrap gap-1">
                          {assignedLaborers.map((laborerId: any) => (
                            <span
                              key={laborerId}
                              className="inline-flex items-center bg-blue-100 text-blue-800 px-2 py-0.5 rounded-full text-xs"
                            >
                              {getEmployeeName(laborerId).split(' ')[1]}
                              <button
                                onClick={() => toggleCrewMember(foreman.id, laborerId)}
                                className="ml-1 text-blue-600 hover:text-blue-800 font-bold"
                              >
                                ×
                              </button>
                            </span>
                          ))}
                        </div>
                      )}

                      {/* Available laborers */}
                      <div className="border border-gray-300 rounded-md max-h-48 overflow-y-auto flex-1">
                        {filteredLaborers.map((laborer: any) => {
                          const isSelected = assignedLaborers.includes(laborer.id);
                          return (
                            <label
                              key={laborer.id}
                              className={`flex items-center px-2 py-1.5 hover:bg-gray-50 cursor-pointer border-b border-gray-100 last:border-b-0 ${
                                isSelected ? 'bg-blue-50' : ''
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => toggleCrewMember(foreman.id, laborer.id)}
                                className="h-3.5 w-3.5 text-blue-600 rounded focus:ring-blue-500"
                              />
                              <span className={`ml-2 text-xs ${isSelected ? 'font-semibold text-blue-900' : 'text-gray-700'}`}>
                                {laborer.firstName} {laborer.lastName}
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    </div>

                    {/* Save Button */}
                    <div className="mt-3">
                      <button
                        onClick={() => saveCrewAssignment(foreman.id)}
                        disabled={saving === foreman.id}
                        className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold px-4 py-2 text-sm rounded-md disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                        {saving === foreman.id ? "Saving..." : "Save"}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
