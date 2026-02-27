"use client";

import { useEffect, useState } from "react";

import { db, getDocs, collection, deleteDoc, doc, updateDoc } from "@/firebase";
import { OnboardingSubmission } from "@/types/onboarding";
import ProtectedPage from "@/components/ProtectedPage";
import Navigation from "@/components/Navigation";

function MaskedValue({ value, isDark = false }: { value: string; isDark?: boolean }) {
  const [show, setShow] = useState(false);
  
  if (!value) return <span className={`text-[10px] font-bold italic ${isDark ? "text-gray-600" : "text-gray-400"}`}>Not Provided</span>;

  return (
    <div className="flex items-center gap-2">
      <span className={`text-xs font-mono tracking-widest transition-all duration-200 ${show ? (isDark ? 'text-white' : 'text-gray-950') : 'blur-[3px] select-none opacity-40'}`}>
        {show ? value : "••••••••••"}
      </span>
      <button 
        type="button"
        onClick={() => setShow(!show)}
        className={`p-1 rounded-md transition-all ${isDark ? 'hover:bg-white/10 text-teal-400' : 'hover:bg-gray-200 text-teal-700'}`}
      >
        {show ? (
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l18 18" /></svg>
        ) : (
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
        )}
      </button>
    </div>
  );
}

export default function OnboardingSubmissionsPage() {
  const [submissions, setSubmissions] = useState<OnboardingSubmission[]>([]);
  const [signoffs, setSignoffs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'payroll' | 'handbook'>('payroll');

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    try {
      const submissionsPromise = getDocs(collection(db, "onboarding_submissions"));
      const signoffsPromise = getDocs(collection(db, "handbook-signoffs"));
      
      const [submissionsSnapshot, signoffsSnapshot] = await Promise.all([
        submissionsPromise,
        signoffsPromise
      ]);

      const submissionsData = submissionsSnapshot.docs.map((doc: any) => ({
        id: doc.id,
        ...doc.data()
      })) as OnboardingSubmission[];
      setSubmissions(submissionsData.sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime()));

      const signoffsData = signoffsSnapshot.docs.map((doc: any) => ({
        id: doc.id,
        ...doc.data()
      })) as any[];
      setSignoffs(signoffsData.sort((a, b) => {
        const dateA = a.signedAt?.toDate() || new Date(0);
        const dateB = b.signedAt?.toDate() || new Date(0);
        return dateB - dateA;
      }));
    } catch (error) {
      console.error("Error loading data:", error);
    } finally {
      setLoading(false);
    }
  }

  async function loadSubmissions() {
    // Kept for backward compatibility if needed, but loadData is preferred
    loadData();
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
    <ProtectedPage page="onboarding">
      <div className="min-h-screen bg-gray-50 flex flex-col font-sans">
        <Navigation />
        
        <main className="flex-1 p-3 sm:p-8">
          <div className="max-w-7xl mx-auto">
            {/* Header */}
            <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6 mb-8 sm:mb-12">
              <div>
                <h1 className="text-3xl sm:text-4xl font-black text-gray-950 uppercase tracking-tighter">Personnel Management</h1>
                <p className="text-gray-700 font-black uppercase text-[10px] sm:text-xs tracking-widest mt-1">Review new hire payroll & company compliance</p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <div className="inline-flex bg-white rounded-2xl p-1 border border-gray-100 shadow-sm mr-4">
                  <button
                    onClick={() => setActiveTab('payroll')}
                    className={`px-6 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
                      activeTab === 'payroll' 
                        ? 'bg-teal-800 text-white shadow-lg shadow-teal-900/20' 
                        : 'text-gray-400 hover:text-gray-600'
                    }`}
                  >
                    Payroll
                  </button>
                  <button
                    onClick={() => setActiveTab('handbook')}
                    className={`px-6 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
                      activeTab === 'handbook' 
                        ? 'bg-teal-800 text-white shadow-lg shadow-teal-900/20' 
                        : 'text-gray-400 hover:text-gray-600'
                    }`}
                  >
                    Handbook
                  </button>
                </div>
                <a href="/onboarding" target="_blank" className="flex-1 sm:flex-none text-center px-6 py-3 bg-white border-2 border-teal-800 text-teal-800 font-black uppercase tracking-widest text-[10px] rounded-2xl hover:bg-teal-50 transition-all shadow-sm">
                  Open Public Form
                </a>
              </div>
            </div>

            {loading ? (
              <div className="bg-white rounded-[2rem] p-12 text-center border border-gray-100 shadow-sm mt-12">
                <div className="animate-spin w-10 h-10 border-4 border-teal-500 border-t-transparent rounded-full mx-auto mb-4"></div>
                <p className="text-gray-500 font-bold uppercase text-[10px] tracking-widest">Loading Records...</p>
              </div>
            ) : activeTab === 'payroll' ? (
              <>
                {submissions.length === 0 ? (
                  <div className="bg-white rounded-[2rem] p-20 text-center border border-gray-100 shadow-sm mt-12">
                    <p className="text-gray-400 font-bold uppercase text-xs tracking-[0.2em]">No payroll submissions found</p>
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
                        <p className="text-xs sm:text-sm font-black text-gray-700 tracking-tight flex items-center gap-2">
                          <svg className="w-4 h-4 text-teal-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
                        <h4 className="text-[10px] font-black uppercase text-gray-600 tracking-widest mb-4 italic flex items-center gap-2">
                          <span className="w-1.5 h-1.5 bg-teal-500 rounded-full"></span>
                          Personal Detail
                        </h4>
                        <div className="space-y-2">
                          <div className="flex flex-col">
                            <span className="text-[9px] font-black text-gray-500 uppercase leading-none mb-1">Birth Date</span>
                            <span className="text-xs sm:text-sm font-black text-gray-950">{sub.dateOfBirth}</span>
                          </div>
                          <div className="flex flex-col">
                            <span className="text-[9px] font-black text-gray-500 uppercase leading-none mb-1">Social Security</span>
                            <MaskedValue value={sub.ssn} />
                          </div>
                          <div className="flex flex-col">
                            <span className="text-[9px] font-black text-gray-500 uppercase leading-none mb-1">Phone Number</span>
                            <span className="text-xs sm:text-sm font-black text-gray-950">{sub.phone}</span>
                          </div>
                          <div className="flex items-center gap-3 mt-4">
                            <a href={`tel:${sub.phone}`} className="w-10 h-10 bg-white rounded-xl border border-gray-200 flex items-center justify-center text-teal-800 hover:bg-teal-50 transition-all shadow-sm">
                              <svg className="w-5 h-5 font-black" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"/></svg>
                            </a>
                            <a href={`mailto:${sub.email}`} className="flex-1 h-10 bg-white rounded-xl border border-gray-200 px-4 flex items-center text-xs font-black text-gray-950 hover:bg-teal-50 transition-all shadow-sm overflow-hidden whitespace-nowrap overflow-ellipsis">
                              {sub.email}
                            </a>
                          </div>
                        </div>
                      </div>

                      <div>
                        <h4 className="text-[10px] font-black uppercase text-gray-600 tracking-widest mb-4 italic flex items-center gap-2">
                          <span className="w-1.5 h-1.5 bg-teal-500 rounded-full"></span>
                          Residential
                        </h4>
                        <p className="text-xs sm:text-sm font-black text-gray-950 leading-relaxed bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
                          {sub.address.street}<br />
                          {sub.address.city}, {sub.address.state} {sub.address.zip}
                        </p>
                      </div>

                      <div>
                        <h4 className="text-[10px] font-black uppercase text-gray-600 tracking-widest mb-4 italic flex items-center gap-2">
                          <span className="w-1.5 h-1.5 bg-teal-500 rounded-full"></span>
                          Tax Verification (W-4)
                        </h4>
                        <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
                          <p className="text-sm font-black text-teal-900 uppercase mb-2">{sub.taxFilingStatus}</p>
                          <ul className="space-y-2">
                            <li className="flex justify-between items-center border-b border-gray-50 pb-1.5">
                              <span className="text-[10px] font-black text-gray-500 uppercase">Multiple Jobs</span>
                              <span className={`text-[10px] font-black px-2 py-0.5 rounded ${sub.multipleJobsOrSpouseWorks ? 'bg-orange-100 text-orange-800' : 'bg-gray-100 text-gray-600'}`}>
                                {sub.multipleJobsOrSpouseWorks ? 'YES' : 'NO'}
                              </span>
                            </li>
                            <li className="flex justify-between items-center border-b border-gray-50 pb-1.5">
                              <span className="text-[10px] font-black text-gray-500 uppercase">Dependents (Step 3)</span>
                              <span className="text-xs font-black text-gray-950">{(sub.claimDependentsAmount || 0).toLocaleString()}</span>
                            </li>
                            {typeof sub.otherIncomeAmount === 'number' && sub.otherIncomeAmount > 0 && (
                              <li className="flex justify-between items-center border-b border-gray-50 pb-1.5">
                                <span className="text-[10px] font-black text-gray-500 uppercase">Other Income</span>
                                <span className="text-xs font-black text-gray-950">${sub.otherIncomeAmount.toLocaleString()}</span>
                              </li>
                            )}
                            {typeof sub.deductionsAmount === 'number' && sub.deductionsAmount > 0 && (
                              <li className="flex justify-between items-center border-b border-gray-50 pb-1.5">
                                <span className="text-[10px] font-black text-gray-500 uppercase">Deductions</span>
                                <span className="text-xs font-black text-gray-950">${sub.deductionsAmount.toLocaleString()}</span>
                              </li>
                            )}
                            <li className="flex justify-between items-center">
                              <span className="text-[10px] font-black text-gray-500 uppercase">Extra Withholding</span>
                              <span className="text-xs font-black text-gray-950">${(sub.extraWithholdingAmount || 0).toLocaleString()}</span>
                            </li>
                          </ul>
                        </div>
                      </div>

                      <div>
                        <h4 className="text-[10px] font-black uppercase text-gray-600 tracking-widest mb-4 italic flex items-center gap-2">
                          <span className="w-1.5 h-1.5 bg-teal-500 rounded-full"></span>
                          Banking (Direct Deposit)
                        </h4>
                        <div className="bg-gray-900 p-4 rounded-xl border border-gray-800 shadow-xl overflow-hidden relative">
                          <div className="absolute -bottom-2 -right-2 w-16 h-16 bg-white opacity-[0.03] rounded-full"></div>
                          <p className="text-xs font-black text-teal-400 uppercase mb-3 tracking-widest">{sub.bankName}</p>
                          <div className="space-y-3">
                            <div className="flex flex-col">
                              <span className="text-[8px] font-black text-gray-400 uppercase leading-none mb-1">Routing Number</span>
                              <MaskedValue value={sub.routingNumber || ""} isDark />
                            </div>
                            <div className="flex flex-col">
                              <span className="text-[8px] font-black text-gray-400 uppercase leading-none mb-1">Account Number</span>
                              <MaskedValue value={sub.accountNumber || ""} isDark />
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Digital Signature & Audit Trail Section */}
                    <div className="bg-white border-t border-gray-100 p-6 sm:p-8">
                      <div className="flex flex-col lg:flex-row gap-8">
                        <div className="flex-1">
                          <h4 className="text-[10px] font-black uppercase text-gray-600 tracking-widest mb-4 italic flex items-center gap-2">
                            <span className="w-1.5 h-1.5 bg-teal-500 rounded-full"></span>
                            Digital Signature Certification
                          </h4>
                          <div className="bg-teal-50 border border-teal-100 p-4 rounded-2xl relative">
                            <div className="mb-4">
                              <p className="text-[9px] font-black text-teal-800/60 uppercase mb-1 tracking-tighter">Legal Declaration</p>
                              <p className="text-[10px] font-bold text-teal-900 leading-tight italic">
                                "Under penalties of perjury, I declare that this certificate, to the best of my knowledge and belief, is true, correct, and complete."
                              </p>
                            </div>
                            <div className="flex items-center justify-between gap-4">
                              <div className="border-b-2 border-teal-800/20 pb-1 flex-1">
                                <p className="text-[8px] font-black text-teal-800/40 uppercase mb-0.5">Electronic Signature</p>
                                <p className="text-xl font-black text-teal-900 tracking-tight italic font-serif select-none">{sub.signatureName}</p>
                              </div>
                              <div className="text-right">
                                <p className="text-[8px] font-black text-teal-800/40 uppercase mb-0.5">Signature Date</p>
                                <p className="text-xs font-black text-teal-900">{sub.signatureDate}</p>
                              </div>
                            </div>
                            <div className="absolute top-2 right-4">
                              <span className="text-[8px] font-black text-teal-600/30 uppercase tracking-[0.3em] font-mono">VERIFIED DIGITAL</span>
                            </div>
                          </div>
                        </div>

                        <div className="lg:w-1/3">
                          <h4 className="text-[10px] font-black uppercase text-gray-600 tracking-widest mb-4 italic flex items-center gap-2">
                            <span className="w-1.5 h-1.5 bg-gray-400 rounded-full"></span>
                            Security Audit Trail
                          </h4>
                          <div className="bg-gray-50 p-4 rounded-2xl border border-gray-100 space-y-3">
                            <div className="flex justify-between items-center group">
                              <span className="text-[9px] font-black text-gray-500 uppercase tracking-tighter">IP Address</span>
                              <span className="text-[10px] font-mono font-black text-gray-900 bg-white px-2 py-0.5 rounded border border-gray-100">{sub.ipAddress || "Not Captured"}</span>
                            </div>
                            <div className="flex flex-col">
                              <span className="text-[9px] font-black text-gray-500 uppercase tracking-tighter mb-1">Device/Browser Agent</span>
                              <div className="text-[9px] font-medium text-gray-400 leading-tight bg-white p-2 rounded border border-gray-100 break-all line-clamp-2" title={sub.userAgent}>
                                {sub.userAgent || "Unknown"}
                              </div>
                            </div>
                            <div className="flex justify-between items-center border-t border-gray-100 pt-2">
                              <span className="text-[9px] font-black text-gray-500 uppercase tracking-tighter">Binding Timestamp</span>
                              <span className="text-[10px] font-black text-gray-950">{new Date(sub.submittedAt).toISOString()}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Dependents Sub-Section (If exists) */}
                    {sub.dependents && sub.dependents.length > 0 && (
                      <div className="bg-white border-t border-gray-100 p-6 sm:p-8">
                        <h4 className="text-[10px] font-black uppercase text-gray-600 tracking-widest mb-5 italic flex items-center gap-2">
                          <span className="w-1.5 h-1.5 bg-orange-500 rounded-full"></span>
                          Claimed Dependents Portfolio
                        </h4>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                          {sub.dependents.map((dep, dIdx) => (
                            <div key={dIdx} className="bg-orange-50/50 p-5 rounded-2xl border border-orange-100/50 hover:bg-orange-50 transition-colors">
                              <p className="text-xs font-black text-gray-950 uppercase mb-2 pb-2 border-b border-orange-100 tracking-tight">{dep.name}</p>
                              <div className="space-y-2">
                                <div className="flex justify-between items-center">
                                  <span className="text-[9px] font-black text-orange-900 uppercase">Birth</span>
                                  <span className="text-xs font-black text-gray-700">{dep.dateOfBirth}</span>
                                </div>
                                <div className="flex justify-between items-center">
                                  <span className="text-[9px] font-black text-orange-900 uppercase">SSN</span>
                                  <MaskedValue value={dep.ssn} />
                                </div>
                                <div className="flex justify-between items-center">
                                  <span className="text-[9px] font-black text-orange-900 uppercase">Rel</span>
                                  <span className="text-[10px] font-black text-orange-700 uppercase italic">{dep.relationship}</span>
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
          </>
        ) : (
              /* Handbook Sign-offs Tab Content */
              <div className="bg-white rounded-[2rem] border border-gray-200 shadow-sm overflow-hidden">
                <div className="bg-stone-900 p-8 border-b border-stone-800">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div>
                      <h2 className="text-xl font-black text-white uppercase tracking-tight">Handbook Compliance Report</h2>
                      <p className="text-[10px] font-black text-stone-400 uppercase tracking-widest mt-1">Audit trail for employee signature acknowledgment</p>
                    </div>
                    <div className="bg-stone-800 border border-stone-700 px-4 py-2 rounded-xl">
                      <span className="text-[9px] font-black text-stone-500 uppercase tracking-widest block mb-0.5">Total Signatures</span>
                      <span className="text-lg font-black text-white">{signoffs.length}</span>
                    </div>
                  </div>
                </div>
                
                {signoffs.length === 0 ? (
                  <div className="p-20 text-center">
                    <p className="text-gray-400 font-bold uppercase text-xs tracking-[0.2em]">No signatures recorded yet</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left">
                      <thead>
                        <tr className="bg-gray-50 border-b border-gray-100">
                          <th className="px-8 py-5 text-[10px] font-black text-gray-500 uppercase tracking-[0.2em]">Employee</th>
                          <th className="px-8 py-5 text-[10px] font-black text-gray-500 uppercase tracking-[0.2em]">Email Address</th>
                          <th className="px-8 py-5 text-[10px] font-black text-gray-500 uppercase tracking-[0.2em]">Signed Date</th>
                          <th className="px-8 py-5 text-[10px] font-black text-gray-500 uppercase tracking-[0.2em]">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {signoffs.map((sig, idx) => (
                          <tr key={sig.id || idx} className="hover:bg-gray-50 transition-colors">
                            <td className="px-8 py-4">
                              <span className="text-sm font-black text-gray-900 uppercase italic tracking-tight">{sig.displayName}</span>
                            </td>
                            <td className="px-8 py-4">
                              <span className="text-xs font-bold text-gray-500 tracking-tight">{sig.email}</span>
                            </td>
                            <td className="px-8 py-4">
                              <span className="text-xs font-black text-gray-700">
                                {sig.signedAt?.toDate ? sig.signedAt.toDate().toLocaleDateString() : 'N/A'}
                                <span className="text-[9px] text-gray-400 ml-2">
                                  {sig.signedAt?.toDate ? sig.signedAt.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                                </span>
                              </span>
                            </td>
                            <td className="px-8 py-4">
                              <span className="px-3 py-1 bg-green-100 text-green-700 rounded-full text-[9px] font-black uppercase tracking-widest">
                                Compliant
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>
        </main>
      </div>
    </ProtectedPage>
  );
}
