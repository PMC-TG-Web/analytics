"use client";

import React, { useState, useEffect } from "react";
import ProtectedPage from "@/components/ProtectedPage";
import Navigation from "@/components/Navigation";
import { useAuth } from "@/hooks/useAuth";
import { db } from "@/firebase";
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";

export default function HandbookPage() {
  const { user } = useAuth();
  const [signed, setSigned] = useState<boolean | null>(null);
  const [signing, setSigning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (user?.email) {
      checkSignStatus();
    }
  }, [user]);

  async function checkSignStatus() {
    try {
      const docRef = doc(db, "handbook-signoffs", user!.email!.toLowerCase());
      const docSnap = await getDoc(docRef);
      setSigned(docSnap.exists());
    } catch (err) {
      console.error("Error checking sign status:", err);
    }
  }

  async function handleSignOff() {
    if (!user?.email) return;
    setSigning(true);
    setError(null);
    try {
      await setDoc(doc(db, "handbook-signoffs", user.email.toLowerCase()), {
        email: user.email,
        signedAt: serverTimestamp(),
        displayName: user.name || "Unknown",
        userAgent: navigator.userAgent,
      });
      setSigned(true);
    } catch (err) {
      setError("Failed to record sign-off. Please try again.");
      console.error("Sign-off error:", err);
    } finally {
      setSigning(false);
    }
  }

  return (
    <ProtectedPage page="handbook">
      <div className="min-h-screen bg-stone-50 flex flex-col font-sans text-slate-900">
        <Navigation currentPage="handbook" />

        <main className="flex-1 p-4 md:p-8 max-w-6xl mx-auto w-full">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 mb-8">
            <div>
              <h1 className="text-3xl md:text-4xl font-black text-gray-950 uppercase tracking-tighter leading-none">
                Company <span className="text-red-800">Handbook</span>
              </h1>
              <p className="text-gray-500 font-bold uppercase text-[10px] tracking-widest mt-2">Policy & Procedure Resource</p>
            </div>

            {signed === true ? (
              <div className="flex items-center gap-2 bg-green-100 text-green-800 px-4 py-2 rounded-2xl border border-green-200">
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                <span className="text-xs font-black uppercase tracking-wider">Handbook Signed</span>
              </div>
            ) : signed === false ? (
              <div className="bg-red-50 text-red-900 px-4 py-2 rounded-2xl border border-red-100 flex items-center gap-3">
                <span className="text-[10px] font-black uppercase tracking-tight">Pending Acknowledgment</span>
                <button
                  onClick={handleSignOff}
                  disabled={signing}
                  className="bg-red-800 text-white px-4 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-red-900 transition-all shadow-md active:scale-95 disabled:opacity-50"
                >
                  {signing ? "Signing..." : "Sign Now"}
                </button>
              </div>
            ) : (
              <div className="w-32 h-8 bg-gray-200 animate-pulse rounded-2xl"></div>
            )}
          </div>

          {error && (
            <div className="bg-red-100 border-l-4 border-red-500 text-red-700 p-4 mb-6 rounded-r-xl" role="alert">
              <p className="font-bold">Error</p>
              <p className="text-xs uppercase font-black">{error}</p>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
            {/* Sidebar / Table of Contents placeholder */}
            <div className="lg:col-span-1 space-y-6">
              <div className="bg-white rounded-[2rem] p-6 shadow-sm border border-gray-100">
                <h3 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-4">Quick Links</h3>
                <ul className="space-y-3">
                  <li>
                    <a href="/public/documents/handbook.pdf" target="_blank" className="text-xs font-bold text-gray-700 hover:text-red-800 flex items-center gap-2 group">
                      <div className="w-1.5 h-1.5 rounded-full bg-red-800 group-hover:scale-125 transition-all"></div>
                      Open PDF in New Tab
                    </a>
                  </li>
                  <li>
                    <a href="#" className="text-xs font-bold text-gray-700 hover:text-red-800 flex items-center gap-2 group">
                      <div className="w-1.5 h-1.5 rounded-full bg-gray-300 group-hover:bg-red-800 transition-all"></div>
                      Benefits Summary
                    </a>
                  </li>
                  <li>
                    <a href="#" className="text-xs font-bold text-gray-700 hover:text-red-800 flex items-center gap-2 group">
                      <div className="w-1.5 h-1.5 rounded-full bg-gray-300 group-hover:bg-red-800 transition-all"></div>
                      Holiday Calendar
                    </a>
                  </li>
                </ul>
              </div>

              <div className="bg-red-900 rounded-[2rem] p-6 text-white shadow-xl shadow-red-900/20">
                <h3 className="text-[10px] font-black uppercase tracking-[0.2em] mb-2 opacity-60">Notice</h3>
                <p className="text-xs font-bold leading-relaxed italic">
                  "This handbook is a guide to help you understand our culture and expectations. Please reach out to HR with any questions."
                </p>
              </div>
            </div>

            {/* Document Viewer */}
            <div className="lg:col-span-3">
              <div className="bg-white rounded-[2rem] overflow-hidden shadow-2xl border border-gray-100 flex flex-col min-h-[700px]">
                <div className="bg-stone-800 p-4 flex justify-between items-center">
                  <span className="text-white font-black uppercase text-[10px] tracking-[0.2em]">Live Document View</span>
                  <div className="flex gap-2">
                    <div className="w-2.5 h-2.5 rounded-full bg-red-500"></div>
                    <div className="w-2.5 h-2.5 rounded-full bg-amber-500"></div>
                    <div className="w-2.5 h-2.5 rounded-full bg-green-500"></div>
                  </div>
                </div>
                <div className="flex-1 bg-gray-200">
                  <iframe 
                    src="/documents/handbook.pdf" 
                    className="w-full h-full min-h-[650px] border-none"
                    title="Company Handbook"
                  />
                </div>
                <div className="p-6 bg-gray-50 border-t border-gray-100 text-center">
                  <p className="text-gray-400 font-bold uppercase text-[9px] tracking-widest">
                    You are viewing the February 2026 Revision
                  </p>
                </div>
              </div>
            </div>
          </div>
        </main>
      </div>
    </ProtectedPage>
  );
}
