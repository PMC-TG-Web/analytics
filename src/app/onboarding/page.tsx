"use client";

import { useState } from "react";
import { OnboardingSubmission } from "@/types/onboarding";
import Navigation from "@/components/Navigation";

export default function OnboardingPage() {
  const [formData, setFormData] = useState<Partial<OnboardingSubmission>>({
    firstName: "",
    lastName: "",
    middleInitial: "",
    ssn: "",
    dateOfBirth: "",
    phone: "",
    email: "",
    address: { street: "", city: "", state: "", zip: "" },
    taxFilingStatus: "Single",
    multipleJobsOrSpouseWorks: false,
    bankName: "",
    routingNumber: "",
    accountNumber: "",
    accountType: "Checking",
    claimDependentsAmount: 0,
    otherIncomeAmount: 0,
    deductionsAmount: 0,
    extraWithholdingAmount: 0,
    dependents: [],
    emergencyContacts: [{ name: "", relationship: "", phone: "" }],
    status: "pending",
    signatureName: "",
    signatureDate: "",
  });

  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);

  const addDependent = () => {
    setFormData({
      ...formData,
      dependents: [...(formData.dependents || []), { name: "", dateOfBirth: "", ssn: "", relationship: "" }]
    });
  };

  const removeDependent = (index: number) => {
    setFormData({
      ...formData,
      dependents: formData.dependents?.filter((_, i) => i !== index)
    });
  };

  const updateDependent = (index: number, field: string, value: string) => {
    const newDeps = [...(formData.dependents || [])];
    newDeps[index] = { ...newDeps[index], [field]: value };
    setFormData({ ...formData, dependents: newDeps });
  };

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      // Basic Audit Trail capturing
      let ip = "Unknown";
      try {
        const ipRes = await fetch("https://api.ipify.org?format=json");
        const ipJson = await ipRes.json();
        ip = ipJson.ip;
      } catch (err) {
        console.warn("Could not capture IP address for audit trail");
      }

      const submission = {
        ...formData,
        submittedAt: new Date().toISOString(),
        userAgent: typeof window !== 'undefined' ? window.navigator.userAgent : "Unknown",
        ipAddress: ip,
      };
      const response = await fetch('/api/onboarding-submissions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(submission)
      });
      const result = await response.json();
      if (result.success) {
        setSubmitted(true);
      } else {
        alert("Failed to save information. Please try again.");
      }
    } catch (error) {
      console.error("Submission failed:", error);
      alert("Failed to save information. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  if (submitted) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white p-12 rounded-3xl shadow-xl max-w-md w-full text-center border border-teal-100">
          <div className="w-20 h-20 bg-teal-100 text-teal-600 rounded-full flex items-center justify-center mx-auto mb-6">
            <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="text-2xl font-black text-gray-900 uppercase tracking-tight mb-2">Registration Complete</h1>
          <p className="text-gray-600 font-medium">Thank you for submitting your info. HR will review it and follow up with you shortly.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-6 sm:py-12 px-3 sm:px-6 lg:px-8 font-sans">
        <div className="max-w-4xl mx-auto">
          {/* Header */}
          <div className="flex justify-between items-start gap-4 mb-8 sm:mb-12">
            <div className="text-center flex-1">
              <h1 className="text-3xl sm:text-4xl font-black text-gray-950 uppercase tracking-tighter mb-2">Employee Onboarding</h1>
              <p className="text-gray-500 font-bold uppercase text-[9px] sm:text-[10px] tracking-[0.2em] italic px-4">Personnel & Payroll Information Request</p>
            </div>
            <Navigation currentPage="employees" />
          </div>

          <form onSubmit={handleSubmit} className="space-y-6 sm:space-y-8 pb-20 sm:pb-0">
            {/* Section: Personal Information */}
            <div className="bg-white rounded-2xl sm:rounded-3xl shadow-sm border border-gray-200 overflow-hidden">
              <div className="bg-teal-800 px-6 sm:px-8 py-4">
                <h2 className="text-white text-[10px] sm:text-xs font-black uppercase tracking-widest italic flex items-center gap-2">
                  <span className="w-2 h-2 bg-teal-400 rounded-full"></span>
                  1. Personal Information
                </h2>
              </div>
              <div className="p-6 sm:p-8 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 sm:gap-6">
                <div>
                  <label className="block text-[10px] font-black uppercase text-gray-500 mb-1">First Name</label>
                  <input required type="text" value={formData.firstName} onChange={e => setFormData({...formData, firstName: e.target.value})} className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:border-teal-500 outline-none font-bold text-gray-900 text-base sm:text-sm" />
                </div>
                <div>
                  <label className="block text-[10px] font-black uppercase text-gray-500 mb-1">Middle Initial</label>
                  <input type="text" maxLength={1} value={formData.middleInitial} onChange={e => setFormData({...formData, middleInitial: e.target.value})} className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:border-teal-500 outline-none font-bold text-gray-900 text-base sm:text-sm" />
                </div>
                <div>
                  <label className="block text-[10px] font-black uppercase text-gray-500 mb-1">Last Name</label>
                  <input required type="text" value={formData.lastName} onChange={e => setFormData({...formData, lastName: e.target.value})} className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:border-teal-500 outline-none font-bold text-gray-900 text-base sm:text-sm" />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-[10px] font-black uppercase text-gray-500 mb-1">Social Security Number (SSN)</label>
                  <input required type="password" placeholder="XXX-XX-XXXX" value={formData.ssn} onChange={e => setFormData({...formData, ssn: e.target.value})} className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:border-teal-500 outline-none font-bold text-gray-900 text-base sm:text-sm" />
                </div>
                <div>
                  <label className="block text-[10px] font-black uppercase text-gray-500 mb-1">Date of Birth</label>
                  <input required type="date" value={formData.dateOfBirth} onChange={e => setFormData({...formData, dateOfBirth: e.target.value})} className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:border-teal-500 outline-none font-bold text-gray-900 text-base sm:text-sm" />
                </div>
                <div>
                  <label className="block text-[10px] font-black uppercase text-gray-500 mb-1">Phone Number</label>
                  <input required type="tel" value={formData.phone} onChange={e => setFormData({...formData, phone: e.target.value})} className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:border-teal-500 outline-none font-bold text-gray-900 text-base sm:text-sm" />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-[10px] font-black uppercase text-gray-500 mb-1">Personal Email</label>
                  <input required type="email" value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})} className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:border-teal-500 outline-none font-bold text-gray-900 text-base sm:text-sm" />
                </div>
              </div>
            </div>

            {/* Section: Address */}
            <div className="bg-white rounded-2xl sm:rounded-3xl shadow-sm border border-gray-200 overflow-hidden">
              <div className="bg-teal-800 px-6 sm:px-8 py-4">
                <h2 className="text-white text-[10px] sm:text-xs font-black uppercase tracking-widest italic flex items-center gap-2">
                  <span className="w-2 h-2 bg-teal-400 rounded-full"></span>
                  2. Residential Address
                </h2>
              </div>
              <div className="p-6 sm:p-8 grid grid-cols-1 sm:grid-cols-4 gap-4 sm:gap-6">
                <div className="sm:col-span-4">
                  <label className="block text-[10px] font-black uppercase text-gray-500 mb-1">Street Address</label>
                  <input required type="text" value={formData.address?.street} onChange={e => setFormData({...formData, address: {...formData.address!, street: e.target.value}})} className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:border-teal-500 outline-none font-bold text-gray-900 text-base sm:text-sm" />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-[10px] font-black uppercase text-gray-500 mb-1">City</label>
                  <input required type="text" value={formData.address?.city} onChange={e => setFormData({...formData, address: {...formData.address!, city: e.target.value}})} className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:border-teal-500 outline-none font-bold text-gray-900 text-base sm:text-sm" />
                </div>
                <div>
                  <label className="block text-[10px] font-black uppercase text-gray-500 mb-1">State</label>
                  <input required type="text" maxLength={2} value={formData.address?.state} onChange={e => setFormData({...formData, address: {...formData.address!, state: e.target.value}})} className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:border-teal-500 outline-none font-bold text-gray-900 text-base sm:text-sm" />
                </div>
                <div>
                  <label className="block text-[10px] font-black uppercase text-gray-500 mb-1">Zip Code</label>
                  <input required type="text" value={formData.address?.zip} onChange={e => setFormData({...formData, address: {...formData.address!, zip: e.target.value}})} className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:border-teal-500 outline-none font-bold text-gray-900 text-base sm:text-sm" />
                </div>
              </div>
            </div>

            {/* Section: Tax Information */}
            <div className="bg-white rounded-2xl sm:rounded-3xl shadow-sm border border-gray-200 overflow-hidden">
              <div className="bg-teal-800 px-6 sm:px-8 py-4">
                <h2 className="text-white text-[10px] sm:text-xs font-black uppercase tracking-widest italic flex items-center gap-2">
                  <span className="w-2 h-2 bg-teal-400 rounded-full"></span>
                  3. Payroll & W-4 Tax Information
                </h2>
              </div>
              <div className="p-6 sm:p-8 space-y-6">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
                  <div>
                    <label className="block text-[10px] font-black uppercase text-gray-500 mb-1">Federal Filing Status</label>
                    <select value={formData.taxFilingStatus} onChange={e => setFormData({...formData, taxFilingStatus: e.target.value as any})} className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:border-teal-500 outline-none font-bold text-gray-900 text-base sm:text-sm">
                      <option value="Single">Single</option>
                      <option value="Married">Married Filing Jointly</option>
                      <option value="Head of Household">Head of Household</option>
                    </select>
                  </div>
                  <div className="flex items-center gap-3 sm:pt-6 h-auto sm:h-full">
                    <input type="checkbox" id="multipleJobs" checked={formData.multipleJobsOrSpouseWorks} onChange={e => setFormData({...formData, multipleJobsOrSpouseWorks: e.target.checked})} className="w-6 h-6 sm:w-5 sm:h-5 accent-teal-600" />
                    <label htmlFor="multipleJobs" className="text-sm font-bold text-gray-700 leading-snug">Multiple Jobs or Spouse Works (Box 2c)</label>
                  </div>
                </div>
                <div className="grid grid-cols-1 xs:grid-cols-2 sm:grid-cols-4 gap-4 sm:gap-6">
                  <div>
                    <label className="block text-[10px] font-black uppercase text-gray-500 mb-1">Dependents Amount ($)</label>
                    <input type="number" placeholder="0" value={formData.claimDependentsAmount} onChange={e => setFormData({...formData, claimDependentsAmount: Number(e.target.value)})} className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:border-teal-500 outline-none font-bold text-gray-900 text-base sm:text-sm" />
                  </div>
                  <div>
                    <label className="block text-[10px] font-black uppercase text-gray-500 mb-1">Other Income ($)</label>
                    <input type="number" placeholder="0" value={formData.otherIncomeAmount} onChange={e => setFormData({...formData, otherIncomeAmount: Number(e.target.value)})} className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:border-teal-500 outline-none font-bold text-gray-900 text-base sm:text-sm" />
                  </div>
                  <div>
                    <label className="block text-[10px] font-black uppercase text-gray-500 mb-1">Deductions ($)</label>
                    <input type="number" placeholder="0" value={formData.deductionsAmount} onChange={e => setFormData({...formData, deductionsAmount: Number(e.target.value)})} className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:border-teal-500 outline-none font-bold text-gray-900 text-base sm:text-sm" />
                  </div>
                  <div>
                    <label className="block text-[10px] font-black uppercase text-gray-500 mb-1">Extra Withholding ($)</label>
                    <input type="number" placeholder="0" value={formData.extraWithholdingAmount} onChange={e => setFormData({...formData, extraWithholdingAmount: Number(e.target.value)})} className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:border-teal-500 outline-none font-bold text-gray-900 text-base sm:text-sm" />
                  </div>
                </div>
              </div>
            </div>

            {/* Section: Dependents */}
            <div className="bg-white rounded-2xl sm:rounded-3xl shadow-sm border border-gray-200 overflow-hidden">
              <div className="bg-teal-800 px-6 sm:px-8 py-4 flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
                <h2 className="text-white text-[10px] sm:text-xs font-black uppercase tracking-widest italic flex items-center gap-2">
                  <span className="w-2 h-2 bg-teal-400 rounded-full"></span>
                  4. Dependents Information
                </h2>
                <button 
                  type="button" 
                  onClick={addDependent}
                  className="bg-teal-700 hover:bg-teal-600 text-white text-[10px] font-black uppercase tracking-widest px-4 py-3 sm:py-2 rounded-xl border border-teal-500 transition-all flex items-center justify-center gap-2 w-full sm:w-auto"
                >
                  <svg className="w-3 h-3 text-teal-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={4} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                  </svg>
                  Add Dependent
                </button>
              </div>
              <div className="p-6 sm:p-8 space-y-6 sm:space-y-8">
                {formData.dependents?.length === 0 ? (
                  <p className="text-gray-400 font-bold uppercase text-[9px] sm:text-[10px] tracking-widest text-center py-4 px-6 border-2 border-dashed border-gray-100 rounded-2xl">No dependents added (Optional)</p>
                ) : (
                  formData.dependents?.map((dep, index) => (
                    <div key={index} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6 p-6 bg-gray-50 rounded-2xl relative border border-gray-100">
                      <button 
                        type="button" 
                        onClick={() => removeDependent(index)}
                        className="absolute -top-3 -right-3 w-8 h-8 bg-red-100 text-red-600 rounded-full flex items-center justify-center hover:bg-red-200 border-2 border-white shadow-sm transition-all z-10"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                      <div>
                        <label className="block text-[10px] font-black uppercase text-gray-500 mb-1">Full Name</label>
                        <input required type="text" value={dep.name} onChange={e => updateDependent(index, 'name', e.target.value)} className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl focus:border-teal-500 outline-none font-bold text-gray-950 text-base sm:text-sm" />
                      </div>
                      <div>
                        <label className="block text-[10px] font-black uppercase text-gray-500 mb-1">Date of Birth</label>
                        <input required type="date" value={dep.dateOfBirth} onChange={e => updateDependent(index, 'dateOfBirth', e.target.value)} className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl focus:border-teal-500 outline-none font-bold text-gray-950 text-base sm:text-sm" />
                      </div>
                      <div>
                        <label className="block text-[10px] font-black uppercase text-gray-500 mb-1">SSN</label>
                        <input required type="password" placeholder="XXX-XX-XXXX" value={dep.ssn} onChange={e => updateDependent(index, 'ssn', e.target.value)} className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl focus:border-teal-500 outline-none font-bold text-gray-950 text-base sm:text-sm" />
                      </div>
                      <div>
                        <label className="block text-[10px] font-black uppercase text-gray-500 mb-1">Relationship</label>
                        <input required type="text" value={dep.relationship} onChange={e => updateDependent(index, 'relationship', e.target.value)} className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl focus:border-teal-500 outline-none font-bold text-gray-950 text-base sm:text-sm" />
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Section: Direct Deposit */}
            <div className="bg-white rounded-2xl sm:rounded-3xl shadow-sm border border-gray-200 overflow-hidden">
              <div className="bg-teal-800 px-6 sm:px-8 py-4">
                <h2 className="text-white text-[10px] sm:text-xs font-black uppercase tracking-widest italic flex items-center gap-2">
                  <span className="w-2 h-2 bg-teal-400 rounded-full"></span>
                  5. Direct Deposit Information (Optional)
                </h2>
              </div>
              <div className="p-6 sm:p-8 grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-6">
                <div>
                  <label className="block text-[10px] font-black uppercase text-gray-500 mb-1">Bank Name</label>
                  <input type="text" value={formData.bankName} onChange={e => setFormData({...formData, bankName: e.target.value})} className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:border-teal-500 outline-none font-bold text-gray-900 text-base sm:text-sm" />
                </div>
                <div>
                  <label className="block text-[10px] font-black uppercase text-gray-500 mb-1">Routing Number</label>
                  <input type="text" value={formData.routingNumber} onChange={e => setFormData({...formData, routingNumber: e.target.value})} className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:border-teal-500 outline-none font-bold text-gray-900 text-base sm:text-sm" />
                </div>
                <div>
                  <label className="block text-[10px] font-black uppercase text-gray-500 mb-1">Account Number</label>
                  <input type="text" value={formData.accountNumber} onChange={e => setFormData({...formData, accountNumber: e.target.value})} className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:border-teal-500 outline-none font-bold text-gray-900 text-base sm:text-sm" />
                </div>
              </div>
            </div>

            {/* Section: Digital Signature */}
            <div className="bg-white rounded-2xl sm:rounded-3xl shadow-sm border border-gray-200 overflow-hidden">
              <div className="bg-teal-800 px-6 sm:px-8 py-4">
                <h2 className="text-white text-[10px] sm:text-xs font-black uppercase tracking-widest italic flex items-center gap-2">
                  <span className="w-2 h-2 bg-teal-400 rounded-full"></span>
                  6. Certification & Digital Signature
                </h2>
              </div>
              <div className="p-6 sm:p-8 space-y-6">
                <div className="bg-orange-50 border border-orange-100 p-4 rounded-xl">
                  <p className="text-[11px] sm:text-xs font-bold text-orange-950 leading-relaxed uppercase tracking-tight">
                    Under penalties of perjury, I declare that this certificate, to the best of my knowledge and belief, is true, correct, and complete. I understand that my electronic signature below is the legal equivalent of a manual/wet signature.
                  </p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
                  <div>
                    <label className="block text-[10px] font-black uppercase text-gray-500 mb-1">Digital Signature (Type Full Name)</label>
                    <input 
                      required 
                      type="text" 
                      value={formData.signatureName} 
                      onChange={e => setFormData({...formData, signatureName: e.target.value})} 
                      placeholder="Enter your full legal name"
                      className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:border-teal-500 outline-none font-bold text-gray-900 text-base sm:text-sm italic" 
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-black uppercase text-gray-500 mb-1">Signature Date</label>
                    <input 
                      required 
                      type="date" 
                      value={formData.signatureDate} 
                      onChange={e => setFormData({...formData, signatureDate: e.target.value})} 
                      className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:border-teal-500 outline-none font-bold text-gray-900 text-base sm:text-sm" 
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Disclaimer & Submit */}
            <div className="p-6 sm:p-10 bg-teal-900 rounded-2xl sm:rounded-3xl border border-teal-950 mb-12 shadow-2xl">
              <p className="text-[10px] sm:text-xs text-teal-300 font-bold leading-relaxed mb-8 opacity-90 uppercase tracking-tight">
                PMC SECURE PORTAL: By submitting this form, you acknowledge that all information provided is accurate and you authorize PMC to process payroll, tax reporting, and employment verification. All data is protected via industry-standard encryption.
              </p>
              <button 
                type="submit" 
                disabled={saving}
                className="w-full py-5 bg-teal-400 text-teal-950 font-black uppercase tracking-[0.1em] rounded-2xl hover:bg-teal-300 transition-all shadow-xl disabled:opacity-50 text-sm sm:text-base border-b-4 border-teal-600 active:translate-y-1 active:border-b-0"
              >
                {saving ? "SAVING SECURELY..." : "SUBMIT ONBOARDING PORTFOLIO"}
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  }
