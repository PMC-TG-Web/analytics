"use client";

import React, { useState, useEffect } from "react";
import dynamic from "next/dynamic";
import ProtectedPage from "@/components/ProtectedPage";
import Navigation from "@/components/Navigation";
import { useAuth } from "@/hooks/useAuth";
import { db } from "@/firebase";
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";

export default function HandbookPage() {
  const Document = dynamic(() => import("react-pdf").then((mod) => mod.Document), { ssr: false });
  const Page = dynamic(() => import("react-pdf").then((mod) => mod.Page), { ssr: false });
  const { user } = useAuth();
  const [signed, setSigned] = useState<boolean | null>(null);
  const [signing, setSigning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [pageNumber, setPageNumber] = useState(1);
  const [scale, setScale] = useState(1.0);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
    import("react-pdf").then(({ pdfjs }) => {
      pdfjs.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.js`;
    });
  }, []);

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
                    <a href="/documents/handbook.pdf" target="_blank" className="text-xs font-bold text-gray-700 hover:text-red-800 flex items-center gap-2 group">
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
                  <div className="bg-white border-b border-gray-100 px-4 py-3 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setPageNumber((p) => Math.max(1, p - 1))}
                        className="px-2 py-1 rounded bg-gray-100 text-gray-700 text-xs font-bold uppercase tracking-wider hover:bg-gray-200"
                        disabled={pageNumber <= 1}
                      >
                        Prev
                      </button>
                      <button
                        type="button"
                        onClick={() => setPageNumber((p) => Math.min(numPages || 1, p + 1))}
                        className="px-2 py-1 rounded bg-gray-100 text-gray-700 text-xs font-bold uppercase tracking-wider hover:bg-gray-200"
                        disabled={numPages > 0 && pageNumber >= numPages}
                      >
                        Next
                      </button>
                      <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">
                        Page {pageNumber}{numPages ? ` of ${numPages}` : ""}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setScale((s) => Math.max(0.75, Number((s - 0.1).toFixed(2))))}
                        className="px-2 py-1 rounded bg-gray-100 text-gray-700 text-xs font-bold uppercase tracking-wider hover:bg-gray-200"
                      >
                        -
                      </button>
                      <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">
                        {Math.round(scale * 100)}%
                      </span>
                      <button
                        type="button"
                        onClick={() => setScale((s) => Math.min(2, Number((s + 0.1).toFixed(2))))}
                        className="px-2 py-1 rounded bg-gray-100 text-gray-700 text-xs font-bold uppercase tracking-wider hover:bg-gray-200"
                      >
                        +
                      </button>
                      <a
                        href="/documents/handbook.pdf"
                        target="_blank"
                        className="px-2 py-1 rounded bg-red-800 text-white text-xs font-bold uppercase tracking-wider hover:bg-red-900"
                      >
                        Open PDF
                      </a>
                    </div>
                  </div>
                  <div className="flex justify-center p-4 overflow-auto">
                    {!isClient ? (
                      <div className="text-gray-500 text-sm">Loading handbook...</div>
                    ) : pdfError ? (
                      <div className="flex flex-col items-center justify-center h-full text-gray-600 text-sm">
                        <p className="font-bold">PDF preview unavailable.</p>
                        <p className="text-xs mt-1">{pdfError}</p>
                        <a href="/documents/handbook.pdf" target="_blank" className="text-red-800 font-bold mt-2">
                          Open handbook PDF
                        </a>
                      </div>
                    ) : (
                      <Document
                        file="/documents/handbook.pdf"
                        onLoadSuccess={({ numPages }) => {
                          setNumPages(numPages);
                          setPageNumber(1);
                        }}
                        onLoadError={(err) => {
                          console.error("PDF load error:", err);
                          setPdfError("Please open the PDF in a new tab.");
                        }}
                        loading={<div className="text-gray-500 text-sm">Loading handbook...</div>}
                      >
                        <Page pageNumber={pageNumber} scale={scale} renderTextLayer={false} renderAnnotationLayer={false} />
                      </Document>
                    )}
                  </div>
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
