"use client";

import { useEffect, useState } from "react";
import { collection, getDocs, doc, deleteDoc, updateDoc } from "firebase/firestore";
import { db } from "@/firebase";
import { OnboardingSubmission } from "@/types/onboarding";
import ProtectedPage from "@/components/ProtectedPage";
import Navigation from "@/components/Navigation";

export default function OnboardingSubmissionsPage() {
  const [submissions, setSubmissions] = useState<OnboardingSubmission[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadSubmissions();
  }, []);

  async function loadSubmissions() {
    try {
      const snapshot = await getDocs(collection(db, "onboarding_submissions"));
      const data = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as OnboardingSubmission[];
      setSubmissions(data.sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime()));
    } catch (error) {
      console.error("Error loading submissions:", error);
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Are you sure you want to delete this submission?")) return;
    try {
      await deleteDoc(doc(db, "onboarding_submissions", id));
      setSubmissions(submissions.filter(s => s.id !== id));
    } catch (error) {
      alert("Error deleting submission");
    }
  }

  async function handleStatusChange(id: string, status: OnboardingSubmission['status']) {
    try {
      await updateDoc(doc(db, "onboarding_submissions", id), { status });
      setSubmissions(submissions.map(s => s.id === id ? { ...s, status } : s));
    } catch (error) {
      alert("Error updating status");
    }
  }

  return (
    <ProtectedPage page="employees">
      <div className="min-h-screen bg-gray-50 flex flex-col font-sans">
        <Navigation />
        
        <main className="flex-1 p-3 sm:p-8">
          <div className="max-w-7xl mx-auto">
            {/* Header */}
            <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6 mb-8 sm:mb-12">
              <div>
                <h1 className="text-3xl sm:text-4xl font-black text-gray-950 uppercase tracking-tighter">Onboarding Submissions</h1>
                <p className="text-gray-500 font-bold uppercase text-[10px] sm:text-xs tracking-widest mt-1">Review new hire payroll & personnel data</p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <a href="/onboarding" target="_blank" className="flex-1 sm:flex-none text-center px-6 py-3 bg-white border-2 border-teal-800 text-teal-800 font-black uppercase tracking-widest text-[10px] rounded-2xl hover:bg-teal-50 transition-all shadow-sm">
                  Open Public Form
                </a>
              </div>
            </div>

            {loading ? (
              <div className="bg-white rounded-[2rem] p-12 text-center border border-gray-100 shadow-sm mt-12">
                <div className="animate-spin w-10 h-10 border-4 border-teal-500 border-t-transparent rounded-full mx-auto mb-4"></div>
                <p className="text-gray-500 font-bold uppercase text-[10px] tracking-widest">Loading Submissions...</p>
              </div>
            ) : submissions.length === 0 ? (
              <div className="bg-white rounded-[2rem] p-20 text-center border border-gray-100 shadow-sm mt-12">
                <p className="text-gray-400 font-bold uppercase text-xs tracking-[0.2em]">No submissions found</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-6 sm:gap-8">
                {submissions.map((sub) => (
                  <div key={sub.id} className="bg-white rounded-[2rem] border border-gray-200 shadow-sm overflow-hidden hover:shadow-md transition-shadow group">
                    {/* Summary Row */}
                    <div className="p-6 sm:p-8 flex flex-col md:flex-row md:items-center gap-6">
                      <div className="flex-1">
                        <div className="flex flex-wrap items-center gap-3 mb-2">
                          <h3 className="text-xl sm:text-2xl font-black text-gray-950 uppercase tracking-tight">
                            {sub.firstName} {sub.lastName}
                          </h3>
                          <span className={`px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest ${
                            sub.status === 'completed' ? 'bg-green-100 text-green-700' : 
                            sub.status === 'processed' ? 'bg-teal-100 text-teal-700' :
                            'bg-orange-100 text-orange-700'
                          }`}>
                            {sub.status}
                          </span>
                        </div>
                        <p className="text-xs sm:text-sm font-bold text-gray-500 tracking-tight flex items-center gap-2">
                          <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                          </svg>
                          Submitted: {new Date(sub.submittedAt).toLocaleDateString()} at {new Date(sub.submittedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </p>
                      </div>

                      <div className="grid grid-cols-2 gap-3 md:flex md:items-center">
                        <select 
                          value={sub.status} 
                          onChange={(e) => handleStatusChange(sub.id!, e.target.value as any)}
                          className="px-5 py-3 bg-gray-50 border border-gray-200 rounded-2xl text-[10px] font-black uppercase tracking-widest outline-none focus:border-teal-500 cursor-pointer shadow-sm hover:bg-white transition-all"
                        >
                          <option value="pending">Pending</option>
                          <option value="processed">Processed</option>
                          <option value="completed">Completed</option>
                        </select>
                        <button 
                          onClick={() => handleDelete(sub.id!)}
                          className="px-5 py-3 bg-red-50 text-red-600 rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-red-100 transition-all border border-red-100 shadow-sm"
                        >
                          Delete
                        </button>
                      </div>
                    </div>

                    {/* Detail Grid */}
                    <div className="bg-gray-50/50 border-t border-gray-100 p-6 sm:p-8 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8">
                      <div>
                        <h4 className="text-[10px] font-black uppercase text-gray-400 tracking-widest mb-4 italic flex items-center gap-2">
                          <span className="w-1.5 h-1.5 bg-teal-500 rounded-full"></span>
                          Personal Detail
                        </h4>
                        <div className="space-y-2">
                          <div className="flex flex-col">
                            <span className="text-[9px] font-black text-gray-400 uppercase leading-none mb-1">Birth Date</span>
                            <span className="text-xs sm:text-sm font-bold text-gray-900">{sub.dateOfBirth}</span>
                          </div>
                          <div className="flex flex-col">
                            <span className="text-[9px] font-black text-gray-400 uppercase leading-none mb-1">Social Security</span>
                            <span className="text-xs sm:text-sm font-bold text-gray-900">{sub.ssn}</span>
                          </div>
                          <div className="flex items-center gap-3 mt-4">
                            <a href={`tel:${sub.phone}`} className="w-10 h-10 bg-white rounded-xl border border-gray-200 flex items-center justify-center text-teal-600 hover:bg-teal-50 transition-all shadow-sm">
                              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"/></svg>
                            </a>
                            <a href={`mailto:${sub.email}`} className="flex-1 h-10 bg-white rounded-xl border border-gray-200 px-4 flex items-center text-xs font-bold text-gray-900 hover:bg-teal-50 transition-all shadow-sm overflow-hidden whitespace-nowrap overflow-ellipsis">
                              {sub.email}
                            </a>
                          </div>
                        </div>
                      </div>

                      <div>
                        <h4 className="text-[10px] font-black uppercase text-gray-400 tracking-widest mb-4 italic flex items-center gap-2">
                          <span className="w-1.5 h-1.5 bg-teal-500 rounded-full"></span>
                          Residential
                        </h4>
                        <p className="text-xs sm:text-sm font-bold text-gray-900 leading-relaxed bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
                          {sub.address.street}<br />
                          {sub.address.city}, {sub.address.state} {sub.address.zip}
                        </p>
                      </div>

                      <div>
                        <h4 className="text-[10px] font-black uppercase text-gray-400 tracking-widest mb-4 italic flex items-center gap-2">
                          <span className="w-1.5 h-1.5 bg-teal-500 rounded-full"></span>
                          Tax Verification (W-4)
                        </h4>
                        <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
                          <p className="text-sm font-black text-teal-800 uppercase mb-2">{sub.taxFilingStatus}</p>
                          <ul className="space-y-2">
                            <li className="flex justify-between items-center border-b border-gray-50 pb-1.5">
                              <span className="text-[10px] font-black text-gray-400 uppercase">Multiple Jobs</span>
                              <span className={`text-[10px] font-black px-2 py-0.5 rounded ${sub.multipleJobsOrSpouseWorks ? 'bg-orange-100 text-orange-600' : 'bg-gray-100 text-gray-400'}`}>
                                {sub.multipleJobsOrSpouseWorks ? 'YES' : 'NO'}
                              </span>
                            </li>
                            <li className="flex justify-between items-center border-b border-gray-50 pb-1.5">
                              <span className="text-[10px] font-black text-gray-400 uppercase">Dependents</span>
                              <span className="text-xs font-bold text-gray-900">${(sub.claimDependentsAmount || 0).toLocaleString()}</span>
                            </li>
                            <li className="flex justify-between items-center">
                              <span className="text-[10px] font-black text-gray-400 uppercase">Extra Withholding</span>
                              <span className="text-xs font-bold text-gray-900">${(sub.extraWithholdingAmount || 0).toLocaleString()}</span>
                            </li>
                          </ul>
                        </div>
                      </div>

                      <div>
                        <h4 className="text-[10px] font-black uppercase text-gray-400 tracking-widest mb-4 italic flex items-center gap-2">
                          <span className="w-1.5 h-1.5 bg-teal-500 rounded-full"></span>
                          Banking (Direct Deposit)
                        </h4>
                        <div className="bg-gray-900 p-4 rounded-xl border border-gray-800 shadow-xl overflow-hidden relative">
                          <div className="absolute -bottom-2 -right-2 w-16 h-16 bg-white opacity-[0.03] rounded-full"></div>
                          <p className="text-xs font-black text-teal-400 uppercase mb-3 tracking-widest">{sub.bankName}</p>
                          <div className="space-y-3">
                            <div className="flex flex-col">
                              <span className="text-[8px] font-black text-gray-500 uppercase leading-none mb-1">Routing Number</span>
                              <span className="text-xs font-mono font-bold text-white tracking-widest">{sub.routingNumber}</span>
                            </div>
                            <div className="flex flex-col">
                              <span className="text-[8px] font-black text-gray-500 uppercase leading-none mb-1">Account Number</span>
                              <span className="text-xs font-mono font-bold text-white tracking-widest">{sub.accountNumber}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Dependents Sub-Section (If exists) */}
                    {sub.dependents && sub.dependents.length > 0 && (
                      <div className="bg-white border-t border-gray-100 p-6 sm:p-8">
                        <h4 className="text-[10px] font-black uppercase text-gray-400 tracking-widest mb-5 italic flex items-center gap-2">
                          <span className="w-1.5 h-1.5 bg-orange-500 rounded-full"></span>
                          Claimed Dependents Portfolio
                        </h4>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                          {sub.dependents.map((dep, dIdx) => (
                            <div key={dIdx} className="bg-orange-50/50 p-5 rounded-2xl border border-orange-100/50 hover:bg-orange-50 transition-colors">
                              <p className="text-xs font-black text-gray-950 uppercase mb-2 pb-2 border-b border-orange-100 tracking-tight">{dep.name}</p>
                              <div className="space-y-2">
                                <div className="flex justify-between items-center">
                                  <span className="text-[9px] font-black text-orange-800/50 uppercase">Birth</span>
                                  <span className="text-xs font-bold text-gray-700">{dep.dateOfBirth}</span>
                                </div>
                                <div className="flex justify-between items-center">
                                  <span className="text-[9px] font-black text-orange-800/50 uppercase">SSN</span>
                                  <span className="text-xs font-bold text-gray-700">{dep.ssn}</span>
                                </div>
                                <div className="flex justify-between items-center">
                                  <span className="text-[9px] font-black text-orange-800/50 uppercase">Rel</span>
                                  <span className="text-[10px] font-black text-orange-600 uppercase italic">{dep.relationship}</span>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </main>
      </div>
    </ProtectedPage>
  );
}
