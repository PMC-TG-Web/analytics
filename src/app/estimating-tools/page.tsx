"use client";
import React, { useState, useEffect } from "react";
import { db } from "@/firebase";
import { collection, getDocs, addDoc, serverTimestamp, query, orderBy, limit } from "firebase/firestore";
import ProtectedPage from "@/components/ProtectedPage";
import Navigation from "@/components/Navigation";

export default function EstimatingToolsPage() {
  return (
    <ProtectedPage page="estimating-tools">
      <EstimatingToolsContent />
    </ProtectedPage>
  );
}

function EstimatingToolsContent() {
  // Default fallback data in case database is empty or slow
  const defaultRebar = [
    { size: "#3", weightPerFoot: 0.376, overlap: 1.38 },
    { size: "#4", weightPerFoot: 0.668, overlap: 1.83 },
    { size: "#5", weightPerFoot: 1.043, overlap: 2.29 },
    { size: "#6", weightPerFoot: 1.502, overlap: 2.75 },
    { size: "#7", weightPerFoot: 2.044, overlap: 3.21 },
    { size: "#8", weightPerFoot: 2.670, overlap: 3.67 }
  ];

  const [constants, setConstants] = useState<any[]>([]);
  const [rebarConstants, setRebarConstants] = useState<any[]>(defaultRebar);
  const [loading, setLoading] = useState(true);
  const [recentCalcs, setRecentCalcs] = useState<any[]>([]);

  // Concrete Calculator State
  const [length, setLength] = useState("");
  const [width, setWidth] = useState("");
  const [thickness, setThickness] = useState("");
  const [waste, setWaste] = useState("10"); // Default 10%
  const [calcResult, setCalcResult] = useState<number | null>(null);
  const [calcName, setCalcName] = useState("");
  const [saving, setSaving] = useState(false);

  // Rebar Calculator State
  const [rebarSize, setRebarSize] = useState("#4");
  const [rebarGridLength, setRebarGridLength] = useState("");
  const [rebarGridWidth, setRebarGridWidth] = useState("");
  const [rebarSpacing, setRebarSpacing] = useState("12"); // inches
  const [rebarQuantity, setRebarQuantity] = useState<number | null>(null);
  const [rebarWeight, setRebarWeight] = useState<number | null>(null);
  const [rebarChairs, setRebarChairs] = useState<number | null>(null);
  const [rebarSticks, setRebarSticks] = useState<number | null>(null);

  // Footer Calculator State
  const [footerLF, setFooterLF] = useState("");
  const [footerWidth, setFooterWidth] = useState("");
  const [footerHeight, setFooterHeight] = useState("");
  const [footerRebarCount, setFooterRebarCount] = useState("4");
  const [footerDowelLength, setFooterDowelLength] = useState("1.5");
  const [footerContinuousAmount, setFooterContinuousAmount] = useState("3");
  const [footerHorizontalsSpacing, setFooterHorizontalsSpacing] = useState("2");
  const [footerDowelsSpacing, setFooterDowelsSpacing] = useState("1");
  const [footerOffset, setFooterOffset] = useState("0.25");
  const [footerCornerCount, setFooterCornerCount] = useState("0");
  const [footerPierCount, setFooterPierCount] = useState("0");
  const [footerChairs, setFooterChairs] = useState("1");
  const [footerRebarSize, setFooterRebarSize] = useState("#4");
  const [footerResult, setFooterResult] = useState<any>(null);

  useEffect(() => {
    calculateConcrete();
  }, [length, width, thickness, waste]);

  useEffect(() => {
    calculateRebar();
  }, [rebarGridLength, rebarGridWidth, rebarSpacing, rebarSize, rebarConstants]);

  useEffect(() => {
    calculateFooter();
  }, [
    footerLF, footerWidth, footerHeight, footerRebarCount, 
    footerHorizontalsSpacing, footerDowelsSpacing, footerDowelLength,
    footerCornerCount, footerPierCount, footerChairs, footerRebarSize,
    waste, rebarConstants, constants
  ]);

  useEffect(() => {
    fetchData();
  }, []);

  async function fetchData() {
    setLoading(true);
    try {
      // Fetch Constants
      const constSnapshot = await getDocs(collection(db, "estimatingConstants"));
      const constData = constSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setConstants(constData);

      // Fetch Rebar Constants
      const rebarSnapshot = await getDocs(collection(db, "rebarConstants"));
      const rData = rebarSnapshot.docs.map(doc => doc.data());
      
      if (rData.length > 0) {
        // Sort once by numeric size
        rData.sort((a, b) => {
          const sizeA = parseInt(a.size?.replace("#", "") || "0");
          const sizeB = parseInt(b.size?.replace("#", "") || "0");
          return sizeA - sizeB;
        });
        setRebarConstants(rData);

        // Set defaults if state is currently empty or doesn't match a size
        if (!rebarSize || !rData.find(r => r.size === rebarSize)) {
          setRebarSize(rData[0].size);
        }
        if (!footerRebarSize || !rData.find(r => r.size === footerRebarSize)) {
          setFooterRebarSize(rData[0].size);
        }
      }

      // Try to find a default waste constant
      const wasteConst = constData.find(c => c.name.toLowerCase().includes("waste"));
      if (wasteConst) setWaste(wasteConst.value.toString());

      // Fetch footer specific constants
      const footerSticks = constData.find(c => c.name === "Rebar Stick Length");
      const cornerDowelConst = constData.find(c => c.name === "Corner Dowels");
      const pierDowelConst = constData.find(c => c.name === "Pier Dowels");
      
      // Update rebar stick length if found
      // (Used local variable in calc functions, maybe move to state if needed)

      // Fetch Recent Calculations
      const calcQuery = query(collection(db, "savedCalculations"), orderBy("timestamp", "desc"), limit(5));
      const calcSnapshot = await getDocs(calcQuery);
      setRecentCalcs(calcSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));

      setLoading(false);
    } catch (error) {
      console.error("Error fetching data:", error);
      setLoading(false);
    }
  }

  const calculateConcrete = () => {
    const l = parseFloat(length);
    const w = parseFloat(width);
    const t = parseFloat(thickness);
    const wst = parseFloat(waste) / 100;

    if (isNaN(l) || isNaN(w) || isNaN(t)) return;

    // (L * W * (T/12)) / 27
    const volume = (l * w * (t / 12)) / 27;
    const finalVolume = Math.ceil(volume * (1 + wst));
    setCalcResult(finalVolume);
  };

  const calculateRebar = () => {
    const l = parseFloat(rebarGridLength) || 0;
    const w = parseFloat(rebarGridWidth) || 0;
    const spacing = parseFloat(rebarSpacing) / 12; // convert to ft
    
    // Load stick length from constants
    const stickLength = constants.find(c => c.name === "Rebar Stick Length")?.value || 20;
    
    if (l <= 0 || w <= 0 || isNaN(spacing) || spacing === 0) {
      setRebarQuantity(0);
      setRebarWeight(0);
      return;
    }

    const rebarSpec = rebarConstants.find(r => r.size?.toString().trim() === rebarSize?.toString().trim());
    if (!rebarSpec) return;

    const overlap = rebarSpec.overlap || 0;
    const effectiveStickLength = stickLength - overlap;

    // Longitudinal bars runs
    const countL = Math.ceil(w / spacing) + 1;
    const runL = l;
    const sticksNeededL = runL / effectiveStickLength;
    const totalFtL = countL * (sticksNeededL * stickLength);

    // Transverse bars runs
    const countW = Math.ceil(l / spacing) + 1;
    const runW = w;
    const sticksNeededW = runW / effectiveStickLength;
    const totalFtW = countW * (sticksNeededW * stickLength);

    const totalFt = totalFtL + totalFtW;
    const totalSticks = (countL * sticksNeededL) + (countW * sticksNeededW);
    const totalWeight = totalFt * (rebarSpec.weightPerFoot || 0);
    const chairs = Math.ceil((l * w) / 16);

    setRebarQuantity(totalFt);
    setRebarWeight(totalWeight);
    setRebarChairs(chairs);
    setRebarSticks(totalSticks);
  };

  const calculateFooter = () => {
    const lf = parseFloat(footerLF);
    const w = parseFloat(footerWidth);
    const h = parseFloat(footerHeight);
    const rebarCount = parseInt(footerRebarCount);
    
    // Load constants from state
    const stickLength = constants.find(c => c.name === "Rebar Stick Length")?.value || 20;
    const endsCount = constants.find(c => c.name === "Ends")?.value || 2;
    const cornerDowelMult = constants.find(c => c.name === "Corner Dowels")?.value || 1;
    const pierDowelMult = constants.find(c => c.name === "Pier Dowels")?.value || 2;

    if (isNaN(lf) || isNaN(w) || isNaN(h)) return;

    // Volume calculation
    const volume = (lf * w * h) / 27;
    const volumeWithWaste = Math.ceil(volume * (1 + (parseFloat(waste) / 100)));

    // Rebar calculation breakdown
    const rebarSpec = rebarConstants.find(r => r.size?.toString().trim() === footerRebarSize?.toString().trim());
    let breakdown = {
      horizontals: { qty: 0, feet: 0 },
      dowels: { qty: 0, feet: 0 },
      continuous: { qty: 0, feet: 0 },
      corners: { qty: 0, feet: 0 },
      piers: { qty: 0, feet: 0 },
      ends: { qty: 0, feet: 0 },
      totalNetLF: 0,
      totalLFWithOverlap: 0,
      baseSticks: 0,
      overlapSticks: 0,
      totalSticks: 0,
      weightLbs: 0,
      weightTons: 0,
      chairs: 0
    };
    
    if (rebarSpec) {
      const overlap = rebarSpec.overlap || 0;
      const effectiveStickLength = stickLength - overlap;

      // 1. Continuous Rebar (Base)
      breakdown.continuous.qty = rebarCount;
      breakdown.continuous.feet = lf * rebarCount;

      // 2. Horizontals
      const hSpacing = parseFloat(footerHorizontalsSpacing);
      if (hSpacing > 0) {
        breakdown.horizontals.qty = Math.floor(lf / hSpacing);
        breakdown.horizontals.feet = breakdown.horizontals.qty * w;
      }

      // 3. Dowels
      const dSpacing = parseFloat(footerDowelsSpacing);
      const dLength = parseFloat(footerDowelLength);
      if (dSpacing > 0) {
        breakdown.dowels.qty = Math.floor(lf / dSpacing);
        breakdown.dowels.feet = breakdown.dowels.qty * dLength;
      }

      // 4. Corners & Piers
      breakdown.corners.qty = (parseInt(footerCornerCount) || 0) * cornerDowelMult;
      breakdown.corners.feet = breakdown.corners.qty * 3; // 3ft per piece
      
      breakdown.piers.qty = (parseInt(footerPierCount) || 0) * pierDowelMult;
      breakdown.piers.feet = breakdown.piers.qty * 5; // 5ft per piece

      // 5. Ends (2ft of extra rebar per end for turn ups/laps)
      breakdown.ends.qty = endsCount;
      breakdown.ends.feet = endsCount * 2; 

      // Totals
      breakdown.totalNetLF = breakdown.continuous.feet + breakdown.horizontals.feet + breakdown.dowels.feet + breakdown.corners.feet + breakdown.piers.feet + breakdown.ends.feet;
      
      // Chairs Logic: Length x Width / 16 rounded up
      breakdown.chairs = Math.ceil((lf * w) / 16);

      // Calculate sticks with overlap logic
      // Only the continuous bars really get 'lapped' in the same way, but usually estimating handles total LF overlap
      const sticksNeeded = breakdown.totalNetLF / effectiveStickLength;
      breakdown.totalLFWithOverlap = sticksNeeded * stickLength;
      
      breakdown.baseSticks = Math.ceil(breakdown.totalNetLF / stickLength);
      breakdown.totalSticks = Math.ceil(breakdown.totalLFWithOverlap / stickLength);
      breakdown.overlapSticks = breakdown.totalSticks - breakdown.baseSticks;
      if (breakdown.overlapSticks < 0) breakdown.overlapSticks = 0;

      // Weight based on full 20' sticks ordered to match field list
      const orderingLF = breakdown.totalSticks * stickLength;
      breakdown.weightLbs = orderingLF * (rebarSpec.weightPerFoot || 0);
      breakdown.weightTons = breakdown.weightLbs / 2000;
      breakdown.chairs = Math.ceil((lf * w) / 16);
    }

    setFooterResult({ ...breakdown, volume: volumeWithWaste });
  };

  const saveCalculation = async () => {
    if (!calcResult || !calcName) {
      alert("Please name your calculation before saving.");
      return;
    }
    setSaving(true);
    try {
      await addDoc(collection(db, "savedCalculations"), {
        name: calcName,
        type: "Concrete",
        inputs: { length, width, thickness, waste },
        result: calcResult.toFixed(2),
        timestamp: serverTimestamp(),
      });
      alert("Calculation saved to database!");
      setCalcName("");
      fetchData(); // Refresh recent
    } catch (e) {
      console.error(e);
      alert("Failed to save.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <main style={{ padding: "32px", background: "#f5f5f5", minHeight: "100vh", color: "#222", fontFamily: "sans-serif" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "32px" }}>
        <h1 style={{ color: "#15616D", fontSize: "32px", margin: 0 }}>Estimating Tools</h1>
        <Navigation currentPage="estimating-tools" />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(400px, 1fr))", gap: "24px" }}>
        {/* Concrete Calculator Card */}
        <div style={cardStyle}>
          <h2 style={cardTitleStyle}>Concrete Yardage Calculator</h2>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "16px" }}>
            <div>
              <label style={labelStyle}>Length (ft)</label>
              <input type="number" value={length} onChange={e => setLength(e.target.value)} style={inputStyle} placeholder="0" />
            </div>
            <div>
              <label style={labelStyle}>Width (ft)</label>
              <input type="number" value={width} onChange={e => setWidth(e.target.value)} style={inputStyle} placeholder="0" />
            </div>
            <div>
              <label style={labelStyle}>Thickness (in)</label>
              <input type="number" value={thickness} onChange={e => setThickness(e.target.value)} style={inputStyle} placeholder="4" />
            </div>
            <div>
              <label style={labelStyle}>Waste (%)</label>
              <input type="number" value={waste} onChange={e => setWaste(e.target.value)} style={inputStyle} placeholder="10" />
            </div>
          </div>

          {calcResult !== null && (
            <div style={{ marginTop: "12px", padding: "16px", background: "#f0fdf4", borderRadius: "8px", border: "1px solid #bbf7d0" }}>
              <div style={{ fontSize: "14px", color: "#166534" }}>Total Required:</div>
              <div style={{ fontSize: "32px", fontWeight: 700, color: "#15803d" }}>
                {calcResult.toFixed(0)} <span style={{ fontSize: "16px" }}>CY</span>
              </div>
              
              <div style={{ marginTop: "16px", borderTop: "1px solid #bbf7d0", paddingTop: "16px" }}>
                <label style={labelStyle}>Save as Label (e.g. Lobby Slab)</label>
                <div style={{ display: "flex", gap: "8px" }}>
                  <input 
                    placeholder="Reference name..." 
                    value={calcName} 
                    onChange={e => setCalcName(e.target.value)} 
                    style={{ ...inputStyle, marginBottom: 0 }} 
                  />
                  <button onClick={saveCalculation} disabled={saving} style={{ ...primaryButtonStyle, width: "auto" }}>
                    {saving ? "..." : "Save"}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Rebar Calculator Card */}
        <div style={cardStyle}>
          <h2 style={cardTitleStyle}>Rebar Grid Calculator</h2>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "16px" }}>
            <div>
              <label style={labelStyle}>Slab Length (ft)</label>
              <input type="number" value={rebarGridLength} onChange={e => setRebarGridLength(e.target.value)} style={inputStyle} placeholder="0" />
            </div>
            <div>
              <label style={labelStyle}>Slab Width (ft)</label>
              <input type="number" value={rebarGridWidth} onChange={e => setRebarGridWidth(e.target.value)} style={inputStyle} placeholder="0" />
            </div>
            <div>
              <label style={labelStyle}>Rebar Size</label>
              <select 
                value={rebarSize} 
                onChange={e => setRebarSize(e.target.value)} 
                style={{...inputStyle, background: "#fff", cursor: "pointer"}}
              >
                {rebarConstants.map(r => (
                  <option key={r.id || r.size} value={r.size}>{r.size} (Weight: {r.weightPerFoot})</option>
                ))}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Spacing (in o.c.)</label>
              <input type="number" value={rebarSpacing} onChange={e => setRebarSpacing(e.target.value)} style={inputStyle} placeholder="12" />
            </div>
          </div>
          
          <p style={{ fontSize: "12px", color: "#666", marginBottom: "12px" }}>
            Calculates a grid of rebar with overlaps for the dimensions specified.
          </p>

          {rebarQuantity !== null && (
            <div style={{ marginTop: "12px", background: "#fff", borderRadius: "8px", border: "1px solid #ddd", overflow: "hidden" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "14px" }}>
                <thead style={{ background: "#f8f9fa" }}>
                  <tr>
                    <th style={{ textAlign: "left", padding: "8px 10px", borderBottom: "1px solid #eee" }}>Item</th>
                    <th style={{ textAlign: "right", padding: "8px 10px", borderBottom: "1px solid #eee" }}>Qty</th>
                    <th style={{ textAlign: "right", padding: "8px 10px", borderBottom: "1px solid #eee" }}>Feet</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td style={{ padding: "8px 10px", fontWeight: 400 }}>Main Grid (Total LF)</td>
                    <td style={{ padding: "8px 10px", textAlign: "right" }}>-</td>
                    <td style={{ padding: "8px 10px", textAlign: "right" }}>{rebarQuantity.toFixed(0)}</td>
                  </tr>
                  <tr>
                    <td style={{ padding: "8px 10px", fontWeight: 400 }}>20' Sticks</td>
                    <td style={{ padding: "8px 10px", textAlign: "right" }}>{Math.ceil(rebarSticks || 0)}</td>
                    <td style={{ padding: "8px 10px", textAlign: "right" }}>{(Math.ceil(rebarSticks || 0) * 20).toFixed(0)}</td>
                  </tr>
                  <tr>
                    <td style={{ padding: "8px 10px", fontWeight: 400 }}>Total Weight (LBS)</td>
                    <td colSpan={2} style={{ padding: "8px 10px", textAlign: "right" }}>{rebarWeight?.toFixed(0)}</td>
                  </tr>
                  <tr style={{ borderTop: "1px solid #eee" }}>
                    <td style={{ padding: "8px 10px", fontWeight: 400 }}>Chairs</td>
                    <td colSpan={2} style={{ padding: "8px 10px", textAlign: "right" }}>{rebarChairs}</td>
                  </tr>
                </tbody>
              </table>

              <div style={{ marginTop: "16px", padding: "12px", background: "#f8f9fa", borderTop: "1px solid #ddd" }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
                  <span style={{ fontWeight: 700, fontSize: "16px" }}>SUMMARY</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span>20' Sticks:</span>
                  <span style={{ fontWeight: 700 }}>{Math.ceil(rebarSticks || 0)} PCS</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span>Total Tons:</span>
                  <span style={{ fontWeight: 700 }}>{((rebarWeight || 0) / 2000).toFixed(2)} TONS</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span>Total Chairs:</span>
                  <span style={{ fontWeight: 700 }}>{rebarChairs} PCS</span>
                </div>
              </div>
              
              <div style={{ padding: "8px 12px", fontSize: "11px", color: "#666", fontStyle: "italic" }}>
                * Includes lapped 20' sticks ({rebarConstants.find(r => r.size === rebarSize)?.overlap}' overlap).
              </div>
            </div>
          )}
        </div>

        {/* Continuous Footer Calculator Card */}
        <div style={cardStyle}>
          <h2 style={cardTitleStyle}>Advanced Continuous Footer Calculator</h2>
          
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "16px" }}>
            <div style={{ gridColumn: "span 2", borderBottom: "1px solid #eee", paddingBottom: "10px", marginBottom: "10px" }}>
              <span style={{ fontSize: "12px", fontWeight: 700, color: "#15616D" }}>DIMENSIONS (FEET)</span>
            </div>
            
            <div style={{ gridColumn: "span 2" }}>
              <label style={labelStyle}>Total Linear Feet (LF)</label>
              <input type="number" value={footerLF} onChange={e => setFooterLF(e.target.value)} style={inputStyle} placeholder="100" />
            </div>
            
            <div>
              <label style={labelStyle}>Width (FT)</label>
              <input type="number" value={footerWidth} onChange={e => setFooterWidth(e.target.value)} style={inputStyle} placeholder="2" />
            </div>
            <div>
              <label style={labelStyle}>Height (FT)</label>
              <input type="number" value={footerHeight} onChange={e => setFooterHeight(e.target.value)} style={inputStyle} placeholder="3" />
            </div>

            <div style={{ gridColumn: "span 2", borderBottom: "1px solid #eee", paddingBottom: "10px", margin: "10px 0" }}>
              <span style={{ fontSize: "12px", fontWeight: 700, color: "#15616D" }}>REINFORCEMENT</span>
            </div>

            <div>
              <label style={labelStyle}>Rebar Size</label>
              <select 
                value={footerRebarSize} 
                onChange={e => setFooterRebarSize(e.target.value)} 
                style={{...inputStyle, background: "#fff", cursor: "pointer"}}
              >
                {rebarConstants.map(r => (
                  <option key={r.id || r.size} value={r.size}>{r.size} ({r.weightPerFoot} lbs/ft)</option>
                ))}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Continuous Rows</label>
              <input type="number" value={footerRebarCount} onChange={e => setFooterRebarCount(e.target.value)} style={inputStyle} placeholder="2" />
            </div>

            <div>
              <label style={labelStyle}>Horizontals @ (LF)</label>
              <input type="number" value={footerHorizontalsSpacing} onChange={e => setFooterHorizontalsSpacing(e.target.value)} style={inputStyle} placeholder="4" title="Spacing between horizontal bars" />
            </div>
            <div>
              <label style={labelStyle}>Dowels @ (LF)</label>
              <input type="number" value={footerDowelsSpacing} onChange={e => setFooterDowelsSpacing(e.target.value)} style={inputStyle} placeholder="2" title="Spacing between dowels" />
            </div>

            <div>
              <label style={labelStyle}>Dowel Length (FT)</label>
              <input type="number" value={footerDowelLength} onChange={e => setFooterDowelLength(e.target.value)} style={inputStyle} placeholder="4" />
            </div>
            <div>
              <label style={labelStyle}>Corner Count</label>
              <input type="number" value={footerCornerCount} onChange={e => setFooterCornerCount(e.target.value)} style={inputStyle} placeholder="4" />
            </div>

            <div>
              <label style={labelStyle}>Pier Count</label>
              <input type="number" value={footerPierCount} onChange={e => setFooterPierCount(e.target.value)} style={inputStyle} placeholder="0" />
            </div>
            <div style={{ padding: "10px", background: "#f9fafb", borderRadius: "8px", border: "1px dashed #ccc", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <span style={{ fontSize: "11px", color: "#666", textAlign: "center" }}>Chairs are calculated automatically: (L×W)/16</span>
            </div>
          </div>

          {footerResult !== null && (
            <div style={{ marginTop: "12px" }}>
              {/* Table Breakdown */}
              <div style={{ background: "#fff", borderRadius: "8px", border: "1px solid #eee", overflow: "hidden", marginBottom: "20px" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "14px" }}>
                  <thead>
                    <tr style={{ borderBottom: "2px solid #333", textAlign: "left" }}>
                      <th style={{ padding: "10px", fontWeight: 700 }}>Rebar</th>
                      <th style={{ padding: "10px", textAlign: "right", fontWeight: 700 }}>Qty</th>
                      <th style={{ padding: "10px", textAlign: "right", fontWeight: 700 }}>feet</th>
                    </tr>
                  </thead>
                  <tbody style={{ fontStyle: "italic" }}>
                    <tr>
                      <td style={{ padding: "8px 10px" }}>Horizontals</td>
                      <td style={{ padding: "8px 10px", textAlign: "right" }}>{footerResult.horizontals.qty}</td>
                      <td style={{ padding: "8px 10px", textAlign: "right" }}>{footerResult.horizontals.feet.toFixed(0)}</td>
                    </tr>
                    <tr>
                      <td style={{ padding: "8px 10px" }}>Dowels</td>
                      <td style={{ padding: "8px 10px", textAlign: "right" }}>{footerResult.dowels.qty}</td>
                      <td style={{ padding: "8px 10px", textAlign: "right" }}>{footerResult.dowels.feet.toFixed(0)}</td>
                    </tr>
                    <tr>
                      <td style={{ padding: "8px 10px" }}>Cont.</td>
                      <td style={{ padding: "8px 10px", textAlign: "right" }}>{footerResult.continuous.qty}</td>
                      <td style={{ padding: "8px 10px", textAlign: "right" }}>{footerResult.continuous.feet.toFixed(0)}</td>
                    </tr>
                    <tr>
                      <td style={{ padding: "8px 10px" }}>Corners</td>
                      <td style={{ padding: "8px 10px", textAlign: "right" }}>{footerResult.corners.qty}</td>
                      <td style={{ padding: "8px 10px", textAlign: "right" }}>{footerResult.corners.feet.toFixed(0)}</td>
                    </tr>
                    <tr style={{ borderBottom: "1px solid #eee" }}>
                      <td style={{ padding: "8px 10px" }}>Piers</td>
                      <td style={{ padding: "8px 10px", textAlign: "right" }}>{footerResult.piers.qty}</td>
                      <td style={{ padding: "8px 10px", textAlign: "right" }}>{footerResult.piers.feet.toFixed(0)}</td>
                    </tr>
                    <tr style={{ borderBottom: "1px solid #eee" }}>
                      <td style={{ padding: "8px 10px" }}>Ends</td>
                      <td style={{ padding: "8px 10px", textAlign: "right" }}>{footerResult.ends.qty}</td>
                      <td style={{ padding: "8px 10px", textAlign: "right" }}>{footerResult.ends.feet.toFixed(0)}</td>
                    </tr>
                    <tr>
                      <td style={{ padding: "8px 10px", fontWeight: 400 }}>Rebar Feet</td>
                      <td colSpan={2} style={{ padding: "8px 10px", textAlign: "right" }}>{footerResult.totalNetLF.toFixed(0)}</td>
                    </tr>
                    <tr>
                      <td style={{ padding: "8px 10px", fontWeight: 400 }}>Rebar Sticks</td>
                      <td colSpan={2} style={{ padding: "8px 10px", textAlign: "right" }}>{footerResult.baseSticks}</td>
                    </tr>
                    <tr>
                      <td style={{ padding: "8px 10px", fontWeight: 400 }}>OverLap Sticks</td>
                      <td colSpan={2} style={{ padding: "8px 10px", textAlign: "right" }}>{footerResult.overlapSticks}</td>
                    </tr>
                    <tr style={{ fontWeight: 600 }}>
                      <td style={{ padding: "8px 10px" }}>Total Rebar Sticks</td>
                      <td colSpan={2} style={{ padding: "8px 10px", textAlign: "right" }}>{footerResult.totalSticks}</td>
                    </tr>
                    <tr>
                      <td style={{ padding: "8px 10px", fontWeight: 400 }}>Rebar Lbs.</td>
                      <td colSpan={2} style={{ padding: "8px 10px", textAlign: "right" }}>{footerResult.weightLbs.toFixed(0)}</td>
                    </tr>
                    <tr>
                      <td style={{ padding: "8px 10px", fontWeight: 400 }}>Rebar Tons</td>
                      <td colSpan={2} style={{ padding: "8px 10px", textAlign: "right" }}>{footerResult.weightTons.toFixed(2)}</td>
                    </tr>
                    <tr style={{ borderTop: "1px solid #eee" }}>
                      <td style={{ padding: "8px 10px", fontWeight: 400 }}>Chairs</td>
                      <td colSpan={2} style={{ padding: "8px 10px", textAlign: "right" }}>{Math.ceil(footerResult.chairs)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* Unified Summary Section */}
              <div style={{ marginTop: "16px", padding: "16px", background: "#f8f9fa", borderRadius: "8px", border: "1px solid #15616D", marginBottom: "16px" }}>
                <div style={{ fontSize: "12px", fontWeight: 700, color: "#15616D", textTransform: "uppercase", marginBottom: "12px" }}>Materials Order Summary</div>
                
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
                  <div style={{ borderRight: "1px solid #ddd", paddingRight: "16px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "8px" }}>
                      <span style={{ fontSize: "14px", color: "#666" }}>Sticks (20')</span>
                      <span style={{ fontSize: "24px", fontWeight: 800 }}>{footerResult.totalSticks}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                      <span style={{ fontSize: "14px", color: "#666" }}>Total Tons</span>
                      <span style={{ fontSize: "24px", fontWeight: 800 }}>{footerResult.weightTons.toFixed(2)}</span>
                    </div>
                  </div>
                  
                  <div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "8px" }}>
                      <span style={{ fontSize: "14px", color: "#666" }}>Chairs</span>
                      <span style={{ fontSize: "24px", fontWeight: 800 }}>{Math.ceil(footerResult.chairs)}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                      <span style={{ fontSize: "14px", color: "#666" }}>Concrete</span>
                      <span style={{ fontSize: "24px", fontWeight: 800 }}>{footerResult.volume.toFixed(0)} <span style={{ fontSize: "14px" }}>CY</span></span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Recent Calculations Sidebar */}
        <div style={cardStyle}>
          <h2 style={cardTitleStyle}>Recent Calculations (Database)</h2>
          {loading ? <p>Loading...</p> : (
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              {recentCalcs.map(c => (
                <div key={c.id} style={{ padding: "12px", border: "1px solid #eee", borderRadius: "8px", background: "#f9fafb" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
                    <span style={{ fontWeight: 600 }}>{c.name}</span>
                    <span style={{ fontSize: "12px", color: "#999" }}>{c.type}</span>
                  </div>
                  <div style={{ fontSize: "18px", fontWeight: 700, color: "#15616D" }}>{c.result} CY</div>
                  <div style={{ fontSize: "11px", color: "#666" }}>
                    {c.inputs.length}'x{c.inputs.width}' @ {c.inputs.thickness}" ({c.inputs.waste}% waste)
                  </div>
                </div>
              ))}
              {recentCalcs.length === 0 && <p style={{ color: "#999", fontSize: "14px" }}>No saved calculations yet.</p>}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

const cardStyle: React.CSSProperties = {
  background: "#ffffff",
  borderRadius: "12px",
  padding: "24px",
  border: "1px solid #ddd",
  boxShadow: "0 2px 4px rgba(0,0,0,0.1)",
};

const cardTitleStyle: React.CSSProperties = {
  fontSize: "20px",
  fontWeight: 600,
  color: "#333",
  margin: "0 0 20px 0",
};

const labelStyle = { display: "block", marginBottom: "4px", fontSize: "12px", fontWeight: 600, color: "#666", textTransform: "uppercase" as const };
const inputStyle = { width: "100%", padding: "10px", border: "1px solid #ddd", borderRadius: "8px", fontSize: "16px", marginBottom: "8px" };
const primaryButtonStyle = {
  width: "100%",
  padding: "12px",
  background: "#15616D",
  color: "#fff",
  border: "none",
  borderRadius: "8px",
  fontWeight: 700,
  cursor: "pointer"
};
