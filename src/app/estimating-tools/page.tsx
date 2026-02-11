"use client";
import React, { useState, useEffect } from "react";
import { db } from "@/firebase";
import { collection, getDocs, addDoc, serverTimestamp, query, orderBy, limit, where } from "firebase/firestore";
import ProtectedPage from "@/components/ProtectedPage";
import Navigation from "@/components/Navigation";

export default function EstimatingToolsPage() {
  return (
    <ProtectedPage page="estimating-tools">
      <EstimatingToolsContent />
    </ProtectedPage>
  );
}

interface Project {
  id: string;
  projectName: string;
  customerName?: string;
  projectNumber?: string;
  customer?: string;
  projectStatus?: string;
  projectArchived?: boolean;
}

interface Calculation {
  id?: string;
  type: string;
  label: string;
  name?: string;
  projectId: string;
  projectName: string;
  customer: string;
  inputs: Record<string, any>;
  result: string | number;
  summary?: string;
  totalCY?: number;
  totalTons?: number;
  timestamp: any;
}

interface Constant {
  id?: string;
  name?: string;
  value?: number | string;
  size?: string;
  overlap?: number;
  weightPerFoot?: number;
}

function EstimatingToolsContent() {
  // Default fallback data in case database is empty or slow
  const defaultRebar = [
    { size: "#3", weightPerFoot: 0.376, overlap: 1.38 },
    { size: "#4", weightPerFoot: 0.668, overlap: 1.83 },
    { size: "#5", weightPerFoot: 1.043, overlap: 2.29 },
    { size: "#6", weightPerFoot: 1.502, overlap: 2.75 },
    { size: "#7", weightPerFoot: 2.044, overlap: 3.21 },
    { size: "#8", weightPerFoot: 2.67, overlap: 3.67 },
  ];

  const [constants, setConstants] = useState<Constant[]>([]);
  const [rebarConstants, setRebarConstants] = useState<Constant[]>(defaultRebar);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [recentCalcs, setRecentCalcs] = useState<Calculation[]>([]);
  const [aggregateTotals, setAggregateTotals] = useState({ cy: 0, tons: 0 });
  
  // Project Search State
  const [projectsList, setProjectsList] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [projectSearch, setProjectSearch] = useState<string>("");

  // Piers Calculator State
  const [pierLength, setPierLength] = useState("");
  const [pierWidth, setPierWidth] = useState("");
  const [pierHeight, setPierHeight] = useState("");
  const [pierDowelLength, setPierDowelLength] = useState("");
  const [pierTieLength, setPierTieLength] = useState("");
  const [pierVerticalCount, setPierVerticalCount] = useState("4");
  const [pierVerticalSize, setPierVerticalSize] = useState("#4");
  const [pierTiesSpacing, setPierTiesSpacing] = useState("12"); // inches
  const [pierExtraTies, setPierExtraTies] = useState("3");
  const [pierQuantity, setPierQuantity] = useState("1");
  const [waste, setWaste] = useState("10"); // Default 10%
  const [pierResult, setPierResult] = useState<Record<string, any> | null>(null);
  const [pierCalcName, setPierCalcName] = useState("");

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
  const [footerHorizontalsSpacing, setFooterHorizontalsSpacing] = useState("2");
  const [footerDowelsSpacing, setFooterDowelsSpacing] = useState("1");
  const [footerCornerCount, setFooterCornerCount] = useState("0");
  const [footerPierCount, setFooterPierCount] = useState("0");
  const [footerRebarSize, setFooterRebarSize] = useState("#4");
  const [footerResult, setFooterResult] = useState<Record<string, any> | null>(null);

  const fetchData = React.useCallback(async () => {
    setLoading(true);
    try {
      // Fetch Projects (active only)
      const projectsSnapshot = await getDocs(query(
        collection(db, "projects"),
        where("status", "not-in", ["Lost", "Archived"])
      ));
      const pData = projectsSnapshot.docs
        .map(doc => ({ id: doc.id, ...doc.data() }) as Project)
        .filter((p: Project) => !p.projectArchived);
      
      // De-duplicate by both ID and Project Name/Number to handle potential database duplicates
      const uniqueMap = new Map();
      pData.forEach(p => {
        const nameKey = `${(p.projectName || "").toLowerCase()}-${(p.projectNumber || "").toLowerCase()}`;
        // If we haven't seen this ID OR this name/number combo yet, keep it
        if (!uniqueMap.has(p.id) && !uniqueMap.has(nameKey)) {
          uniqueMap.set(p.id, p);
          uniqueMap.set(nameKey, p);
        }
      });

      // Get unique project objects only
      const uniqueProjects = Array.from(new Set(uniqueMap.values())) as Project[];
      
      setProjectsList(uniqueProjects.sort((a, b) => 
        (a.projectName || "").localeCompare(b.projectName || "")
      ));

      // Fetch Constants
      const constSnapshot = await getDocs(collection(db, "estimatingConstants"));
      const constData = constSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Constant[];
      setConstants(constData);

      // Fetch Rebar Constants
      const rebarSnapshot = await getDocs(collection(db, "rebarConstants"));
      const rData = rebarSnapshot.docs.map(doc => doc.data()) as Constant[];
      
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
          setRebarSize(rData[0].size || "#4");
        }
        if (!footerRebarSize || !rData.find(r => r.size === footerRebarSize)) {
          setFooterRebarSize(rData[0].size || "#4");
        }
      }

      // Try to find a default waste constant
      const wasteConst = constData.find(c => (c.name || "").toLowerCase().includes("waste"));
      if (wasteConst) setWaste(wasteConst.value?.toString() || "10");

      // Fetch Recent Calculations - Filtered by project if one is selected
      // Note: We removed the orderBy from the filtered query to avoid a composite index requirement,
      // and will sort client-side instead.
      let calcQuery;
      if (selectedProjectId) {
        calcQuery = query(
          collection(db, "savedCalculations"), 
          where("projectId", "==", selectedProjectId),
          limit(200) // Fetch a larger buffer to sort client-side
        );
      } else {
        calcQuery = query(
          collection(db, "savedCalculations"), 
          orderBy("timestamp", "desc"), 
          limit(50)
        );
      }
      
      const calcSnapshot = await getDocs(calcQuery);
      let allCalcs = calcSnapshot.docs.map(doc => {
        const data = doc.data();
        let totalCY = data.totalCY || 0;
        let totalTons = data.totalTons || 0;

        // Legacy extraction if numeric fields are missing
        if (data.totalCY === undefined) {
          if (data.type === "Pier" || data.type === "Concrete") {
            totalCY = parseFloat(data.result) || 0;
          } else if (data.type === "Footer" && data.summary) {
            const match = data.summary.match(/(\d+)\s*CY/);
            if (match) totalCY = parseFloat(match[1]);
          }
        }
        if (data.totalTons === undefined) {
          if (data.type === "Rebar" && data.summary) {
            const match = data.summary.match(/([\d\.]+)\s*lbs/);
            if (match) totalTons = parseFloat(match[1]) / 2000;
          } else if (data.type === "Footer" && data.summary) {
            const match = data.summary.match(/([\d\.]+)\s*tons/);
            if (match) totalTons = parseFloat(match[1]);
          }
        }

        return { id: doc.id, ...data, totalCY, totalTons } as Calculation;
      });

      // Sort client-side if we are filtered by project (since Firestore index isn't ready)
      if (selectedProjectId) {
        allCalcs.sort((a, b) => {
          const timeA = a.timestamp?.seconds || 0;
          const timeB = b.timestamp?.seconds || 0;
          return timeB - timeA;
        });
      }
      
      // De-duplicate: Keep only the latest calculation for each Project + Label + Type combination
      const uniqueCalcsMap = new Map();
      allCalcs.forEach(c => {
        const key = `${c.projectId}-${c.type}-${(c.label || c.name || "").toLowerCase()}`;
        if (!uniqueCalcsMap.has(key)) {
          uniqueCalcsMap.set(key, c);
        }
      });

      const uniqueCalcs = Array.from(uniqueCalcsMap.values()) as Calculation[];
      setRecentCalcs(uniqueCalcs.slice(0, 50)); // Show up to 50 unique records

      // Calculate aggregates from the unique (latest) set
      const totals = uniqueCalcs.reduce((acc, current) => {
        acc.cy += (current.totalCY || 0);
        acc.tons += (current.totalTons || 0);
        return acc;
      }, { cy: 0, tons: 0 });
      setAggregateTotals(totals);

      setLoading(false);
    } catch (error) {
      console.error("Error fetching data:", error);
      setLoading(false);
    }
  }, [selectedProjectId]); // Added selectedProjectId to re-fetch when project changes

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (pierHeight) {
      const h = parseFloat(pierHeight);
      if (!isNaN(h)) {
        // Auto-calculate dowel length as height + 1.25ft
        setPierDowelLength((h + 1.25).toString());
      }
    } else {
      setPierDowelLength("");
    }
  }, [pierHeight]);

  useEffect(() => {
    if (pierLength && pierWidth) {
      const l = parseFloat(pierLength);
      const w = parseFloat(pierWidth);
      if (!isNaN(l) && !isNaN(w)) {
        // Auto-calculate tie length as perimeter of steel (Pier dim - 0.25ft cover) + 1ft hook
        const tieL = (l - 0.25);
        const tieW = (w - 0.25);
        setPierTieLength(((tieL * 2) + (tieW * 2) + 1).toString());
      }
    } else {
      setPierTieLength("");
    }
  }, [pierLength, pierWidth]);

  const calculatePiers = React.useCallback(() => {
    const l = parseFloat(pierLength);
    const w = parseFloat(pierWidth);
    const h = parseFloat(pierHeight);
    const dowelL = parseFloat(pierDowelLength);
    const tieL = parseFloat(pierTieLength);
    const qty = parseFloat(pierQuantity);
    const vertCount = parseInt(pierVerticalCount);
    const tieSpacing = (parseFloat(pierTiesSpacing) || 12) / 12; // convert to ft
    const extraTies = parseInt(pierExtraTies) || 0;
    const wst = parseFloat(waste) / 100;

    if (isNaN(l) || isNaN(w) || isNaN(h) || isNaN(qty)) {
      setPierResult(null);
      return;
    }

    // Volume of rectangular pier: L * W * H
    const volumeCuFt = l * w * h;
    const totalVolumeCY = Math.ceil((volumeCuFt * qty * (1 + wst)) / 27);

    // Form S.F. calculation: Perimeter (ft) * Height (ft) * Quantity
    const totalFormsSF = ((l * 2) + (w * 2)) * h * qty;

    // Rebar - Load stick length from constants
    const stickLength = constants.find(c => c.name === "Rebar Stick Length")?.value || 20;
    const rebarSpec = rebarConstants.find(r => r.size?.toString().trim() === pierVerticalSize?.toString().trim());
    
    let totalVerticalLF = 0;
    let totalTiesLF = 0;
    let totalSticks = 0;
    let weightLbs = 0;

    if (rebarSpec && !isNaN(dowelL)) {
      // 1. Verticals (Straight bars) - Using explicit Dowel Length
      totalVerticalLF = vertCount * dowelL * qty;
      
      // 2. Ties (Using explicit Tie Length)
      const tiesPerPier = Math.ceil(h / tieSpacing) + extraTies;
      totalTiesLF = tiesPerPier * (tieL || 0) * qty;
      
      const totalLF = totalVerticalLF + totalTiesLF;
      totalSticks = Math.ceil(totalLF / stickLength);
      weightLbs = totalLF * (rebarSpec.weightPerFoot || 0);
    }
    
    setPierResult({
      volume: totalVolumeCY,
      formsSF: totalFormsSF,
      verticalLF: totalVerticalLF,
      tiesLF: totalTiesLF,
      totalSticks,
      weightTons: weightLbs / 2000,
      weightLbs
    });
  }, [
    pierLength, pierWidth, pierHeight, pierDowelLength, pierTieLength, pierQuantity, 
    pierVerticalCount, pierVerticalSize, pierTiesSpacing, 
    pierExtraTies, waste, constants, rebarConstants
  ]);

  const calculateRebar = React.useCallback(() => {
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
  }, [rebarGridLength, rebarGridWidth, rebarSpacing, constants, rebarConstants, rebarSize]);

  const calculateFooter = React.useCallback(() => {
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
    const breakdown = {
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
  }, [
    footerLF, footerWidth, footerHeight, footerRebarCount, constants,
    waste, rebarConstants, footerRebarSize, footerHorizontalsSpacing,
    footerDowelsSpacing, footerDowelLength, footerCornerCount, footerPierCount
  ]);

  useEffect(() => {
    calculatePiers();
  }, [calculatePiers]);

  useEffect(() => {
    calculateRebar();
  }, [calculateRebar]);

  useEffect(() => {
    calculateFooter();
  }, [calculateFooter]);

  const saveCalculation = async (type: "Pier" | "Rebar" | "Footer", label: string, data: { inputs: any; result: string; summary?: string; totalCY?: number; totalTons?: number }) => {
    if (!selectedProjectId) {
      alert("Please select a project first.");
      return;
    }
    if (!label) {
      alert("Please enter a name/label for this calculation.");
      return;
    }

    const project = projectsList.find(p => p.id === selectedProjectId);
    
    setSaving(true);
    try {
      await addDoc(collection(db, "savedCalculations"), {
        projectName: project?.projectName || "Unknown",
        projectId: selectedProjectId,
        customer: project?.customer || "Unknown",
        label: label,
        type: type,
        inputs: data.inputs,
        result: data.result,
        summary: data.summary || "",
        totalCY: data.totalCY || 0,
        totalTons: data.totalTons || 0,
        timestamp: serverTimestamp(),
      });
      // Removed success alert for smoother UX
      fetchData(); // Refresh recent
    } catch (e) {
      console.error(e);
      alert("Failed to save.");
    } finally {
      setSaving(false);
    }
  };

  const handleSavePiers = () => {
    saveCalculation("Pier", pierCalcName, {
      inputs: { 
        length: pierLength, 
        width: pierWidth, 
        height: pierHeight, 
        dowelLength: pierDowelLength,
        tieLength: pierTieLength,
        verticalCount: pierVerticalCount,
        verticalSize: pierVerticalSize,
        tiesSpacing: pierTiesSpacing,
        extraTies: pierExtraTies,
        quantity: pierQuantity,
        waste, 
        label: pierCalcName 
      },
      result: `${pierResult?.totalSticks} sticks`,
      summary: `${pierResult?.volume} CY, ${pierResult?.formsSF.toFixed(0)} SF Form, ${pierResult?.weightTons.toFixed(2)} tons rebar`,
      totalCY: pierResult?.volume || 0,
      totalTons: pierResult?.weightTons || 0
    });
    setPierCalcName("");
  };

  const [rebarCalcName, setRebarCalcName] = useState("");
  const handleSaveRebar = () => {
    saveCalculation("Rebar", rebarCalcName, {
      inputs: { 
        length: rebarGridLength, 
        width: rebarGridWidth, 
        spacing: rebarSpacing, 
        size: rebarSize,
        label: rebarCalcName 
      },
      result: `${Math.ceil(rebarSticks || 0)} sticks`,
      summary: `${rebarWeight?.toFixed(0)} lbs, ${rebarChairs} chairs`,
      totalTons: (rebarWeight || 0) / 2000
    });
    setRebarCalcName("");
  };

  const [footerCalcName, setFooterCalcName] = useState("");
  const handleSaveFooter = () => {
    saveCalculation("Footer", footerCalcName, {
      inputs: { 
        lf: footerLF, 
        width: footerWidth, 
        height: footerHeight, 
        rebarCount: footerRebarCount,
        rebarSize: footerRebarSize,
        horizontalsSpacing: footerHorizontalsSpacing,
        dowelsSpacing: footerDowelsSpacing,
        dowelLength: footerDowelLength,
        cornerCount: footerCornerCount,
        pierCount: footerPierCount,
        waste,
        label: footerCalcName
      },
      result: `${footerResult?.totalSticks} sticks`,
      summary: `${footerResult?.volume.toFixed(0)} CY concrete, ${footerResult?.weightTons.toFixed(2)} tons rebar`,
      totalCY: footerResult?.volume || 0,
      totalTons: footerResult?.weightTons || 0
    });
    setFooterCalcName("");
  };

  const formatTimestamp = (ts: any) => {
    if (!ts) return "Just now";
    try {
      const date = ts.toDate ? ts.toDate() : new Date(ts);
      return date.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
    } catch (e) {
      return "";
    }
  };

  const loadCalculation = (calc: Calculation) => {
    setSelectedProjectId(calc.projectId);
    
    if (calc.type === "Pier" || calc.type === "Concrete") {
      setPierLength(calc.inputs.length || calc.inputs.diameter || "");
      setPierWidth(calc.inputs.width || calc.inputs.diameter || "");
      setPierHeight(calc.inputs.height || calc.inputs.depth || "");
      setPierDowelLength(calc.inputs.dowelLength || "");
      setPierTieLength(calc.inputs.tieLength || "");
      setPierVerticalCount(calc.inputs.verticalCount || "4");
      setPierVerticalSize(calc.inputs.verticalSize || "#4");
      setPierTiesSpacing(calc.inputs.tiesSpacing || "12");
      setPierExtraTies(calc.inputs.extraTies || "3");
      setPierQuantity(calc.inputs.quantity || "1");
      setWaste(calc.inputs.waste || "10");
      setPierCalcName(calc.inputs.label || calc.label || "");
    } else if (calc.type === "Rebar") {
      setRebarGridLength(calc.inputs.length || "");
      setRebarGridWidth(calc.inputs.width || "");
      setRebarSpacing(calc.inputs.spacing || "12");
      setRebarSize(calc.inputs.size || "#4");
      setRebarCalcName(calc.inputs.label || calc.label || "");
    } else if (calc.type === "Footer") {
      setFooterLF(calc.inputs.lf || "");
      setFooterWidth(calc.inputs.width || "");
      setFooterHeight(calc.inputs.height || "");
      setFooterRebarCount(calc.inputs.rebarCount || "4");
      setFooterRebarSize(calc.inputs.rebarSize || "#4");
      setFooterHorizontalsSpacing(calc.inputs.horizontalsSpacing || "2");
      setFooterDowelsSpacing(calc.inputs.dowelsSpacing || "1");
      setFooterDowelLength(calc.inputs.dowelLength || "1.5");
      setFooterCornerCount(calc.inputs.cornerCount || "0");
      setFooterPierCount(calc.inputs.pierCount || "0");
      setWaste(calc.inputs.waste || "10");
      setFooterCalcName(calc.inputs.label || calc.label || "");
    }
    
    // Smooth scroll to top or to the relevant section if needed, 
    // but usually user just wants the fields filled.
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const downloadBreakdown = () => {
    if (recentCalcs.length === 0) return;

    const headers = ["Label", "Project", "Type", "Result", "Concrete (CY)", "Rebar (Tons)", "Details", "Date"];
    const rows = recentCalcs.map(c => [
      `"${c.label || c.name || ""}"`,
      `"${c.projectName}"`,
      c.type,
      `"${c.result}"`,
      (c.totalCY || 0).toFixed(0),
      (c.totalTons || 0).toFixed(2),
      `"${c.type === "Pier" || c.type === "Concrete" ? `${c.inputs?.diameter || c.inputs?.length}x${c.inputs?.depth || c.inputs?.width}` : c.type === "Footer" ? `${c.inputs?.lf} LF, ${c.inputs?.width} wide` : `${c.inputs?.length}x${c.inputs?.width} grid`}"`,
      `"${formatTimestamp(c.timestamp)}"`
    ]);

    const csvContent = [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `PMC_Estimating_Breakdown_${new Date().toISOString().split("T")[0]}.csv`);
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <main style={{ padding: "32px", background: "#f5f5f5", minHeight: "100vh", color: "#222", fontFamily: "sans-serif" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
        <h1 style={{ color: "#15616D", fontSize: "32px", margin: 0 }}>Estimating Tools</h1>
        <Navigation currentPage="estimating-tools" />
      </div>

      {/* Project Selector Bar */}
      <div style={{ ...cardStyle, padding: "16px", marginBottom: "24px", background: "#15616D", borderColor: "#0e4048" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "16px", color: "white" }}>
          <div style={{ flex: 1 }}>
            <label style={{ ...labelStyle, color: "rgba(255,255,255,0.8)" }}>Select Project for Estimate</label>
            <div style={{ display: "flex", gap: "10px" }}>
              <select 
                value={selectedProjectId} 
                onChange={e => setSelectedProjectId(e.target.value)}
                style={{ ...inputStyle, marginBottom: 0, flex: 1, background: "white" }}
              >
                <option value="">-- Choose a project --</option>
                {projectsList
                  .filter(p => {
                    if (!projectSearch) return true;
                    const search = projectSearch.toLowerCase();
                    return p.projectName?.toLowerCase().includes(search) || 
                           p.customer?.toLowerCase().includes(search) || 
                           p.projectNumber?.toLowerCase().includes(search);
                  })
                  .map(p => (
                    <option key={p.id} value={p.id}>
                      {p.customer} - {p.projectName} ({p.projectNumber})
                    </option>
                  ))
                }
              </select>
              <input 
                placeholder="Search projects..." 
                value={projectSearch}
                onChange={e => setProjectSearch(e.target.value)}
                style={{ ...inputStyle, marginBottom: 0, width: "200px", background: "white" }}
              />
            </div>
          </div>
          {selectedProjectId && (
            <div style={{ textAlign: "right", background: "rgba(255,255,255,0.1)", padding: "10px 15px", borderRadius: "8px" }}>
              <div style={{ fontSize: "12px", opacity: 0.8 }}>CURRENT PROJECT RECORD</div>
              <div style={{ fontSize: "16px", fontWeight: 700 }}>
                {projectsList.find(p => p.id === selectedProjectId)?.projectName}
              </div>
            </div>
          )}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(400px, 1fr))", gap: "24px" }}>
        {/* Piers Calculator Card */}
        <div style={cardStyle}>
          <h2 style={cardTitleStyle}>Advanced Piers Calculator</h2>
          
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "16px" }}>
            <div style={{ gridColumn: "span 2", borderBottom: "1px solid #eee", paddingBottom: "10px", marginBottom: "10px" }}>
              <span style={{ fontSize: "12px", fontWeight: 700, color: "#15616D" }}>PIER DIMENSIONS (FEET)</span>
            </div>
            
            <div>
              <label style={labelStyle}>Pier Length</label>
              <input type="number" value={pierLength} onChange={e => setPierLength(e.target.value)} style={inputStyle} placeholder="2" />
            </div>
            <div>
              <label style={labelStyle}>Pier Width</label>
              <input type="number" value={pierWidth} onChange={e => setPierWidth(e.target.value)} style={inputStyle} placeholder="2" />
            </div>
            <div>
              <label style={labelStyle}>Pier Height</label>
              <input type="number" value={pierHeight} onChange={e => setPierHeight(e.target.value)} style={inputStyle} placeholder="4" />
            </div>
            <div>
              <label style={labelStyle}>Count of Piers</label>
              <input type="number" value={pierQuantity} onChange={e => setPierQuantity(e.target.value)} style={inputStyle} placeholder="1" />
            </div>

            <div style={{ gridColumn: "span 2", borderBottom: "1px solid #eee", paddingBottom: "10px", margin: "10px 0" }}>
              <span style={{ fontSize: "12px", fontWeight: 700, color: "#15616D" }}>REINFORCEMENT</span>
            </div>

            <div>
              <label style={labelStyle}>Vertical Dowel Count</label>
              <input type="number" value={pierVerticalCount} onChange={e => setPierVerticalCount(e.target.value)} style={inputStyle} placeholder="4" />
            </div>
            <div>
              <label style={labelStyle}>Vertical Rebar Size</label>
              <select 
                value={pierVerticalSize} 
                onChange={e => setPierVerticalSize(e.target.value)} 
                style={{...inputStyle, background: "#fff", cursor: "pointer"}}
              >
                {rebarConstants.map(r => (
                  <option key={r.id || r.size} value={r.size}>{r.size} ({r.weightPerFoot} lbs/ft)</option>
                ))}
              </select>
            </div>

            <div>
              <label style={labelStyle}>Dowel Length (FT) <span style={{fontSize: "10px", color: "#666", fontWeight: "normal"}}>(Auto-calc)</span></label>
              <input type="number" value={pierDowelLength} onChange={e => setPierDowelLength(e.target.value)} style={inputStyle} placeholder="5.25" />
            </div>

            <div>
              <label style={labelStyle}>Tie Length (FT) <span style={{fontSize: "10px", color: "#666", fontWeight: "normal"}}>(Auto-calc)</span></label>
              <input type="number" value={pierTieLength} onChange={e => setPierTieLength(e.target.value)} style={inputStyle} placeholder="9" />
            </div>

            <div>
              <label style={labelStyle}>Ties O.C. @ Inches</label>
              <input type="number" value={pierTiesSpacing} onChange={e => setPierTiesSpacing(e.target.value)} style={inputStyle} placeholder="12" />
            </div>
            <div>
              <label style={labelStyle}>Add Ties on Top Count</label>
              <input type="number" value={pierExtraTies} onChange={e => setPierExtraTies(e.target.value)} style={inputStyle} placeholder="3" />
            </div>

            <div>
              <label style={labelStyle}>Waste (%)</label>
              <input type="number" value={waste} onChange={e => setWaste(e.target.value)} style={inputStyle} placeholder="10" />
            </div>
          </div>

          {pierResult !== null && (
            <div style={{ marginTop: "12px" }}>
              {/* Results Summary */}
              <div style={{ background: "#f8f9fa", borderRadius: "8px", border: "1px solid #15616D", padding: "16px", marginBottom: "16px" }}>
                <div style={{ fontSize: "12px", fontWeight: 700, color: "#15616D", textTransform: "uppercase", marginBottom: "12px" }}>Materials Summary</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
                  <div>
                    <div style={{ fontSize: "10px", color: "#666", textTransform: "uppercase" }}>Concrete Volume</div>
                    <div style={{ fontSize: "24px", fontWeight: 800, color: "#15616D" }}>{pierResult.volume} <span style={{ fontSize: "12px" }}>CY</span></div>
                  </div>
                  <div>
                    <div style={{ fontSize: "10px", color: "#666", textTransform: "uppercase" }}>Rebar Weight</div>
                    <div style={{ fontSize: "24px", fontWeight: 800, color: "#15616D" }}>{pierResult.weightTons.toFixed(2)} <span style={{ fontSize: "12px" }}>TONS</span></div>
                  </div>
                  <div>
                    <div style={{ fontSize: "10px", color: "#666", textTransform: "uppercase" }}>Form Area</div>
                    <div style={{ fontSize: "24px", fontWeight: 800, color: "#15616D" }}>{pierResult.formsSF.toFixed(0)} <span style={{ fontSize: "12px" }}>S.F.</span></div>
                  </div>
                  <div style={{ borderTop: "1px solid #ddd", paddingTop: "8px" }}>
                    <div style={{ fontSize: "10px", color: "#666", textTransform: "uppercase" }}>Total LF</div>
                    <div style={{ fontSize: "18px", fontWeight: 700 }}>{(pierResult.verticalLF + pierResult.tiesLF).toFixed(0)} <span style={{ fontSize: "12px" }}>FT</span></div>
                  </div>
                  <div style={{ borderTop: "1px solid #ddd", paddingTop: "8px" }}>
                    <div style={{ fontSize: "10px", color: "#666", textTransform: "uppercase" }}>20&apos; Sticks</div>
                    <div style={{ fontSize: "18px", fontWeight: 700 }}>{pierResult.totalSticks} <span style={{ fontSize: "12px" }}>PCS</span></div>
                  </div>
                </div>
              </div>
              
              <div style={{ padding: "16px", borderTop: "1px solid #ddd", background: "#f0f9ff", borderRadius: "8px" }}>
                <label style={labelStyle}>Save Pier Breakdown</label>
                <div style={{ display: "flex", gap: "8px" }}>
                  <input 
                    placeholder="e.g. Line B Piers..." 
                    value={pierCalcName} 
                    onChange={e => setPierCalcName(e.target.value)} 
                    onKeyDown={e => e.key === "Enter" && handleSavePiers()}
                    style={{ ...inputStyle, marginBottom: 0 }} 
                  />
                  <button onClick={handleSavePiers} disabled={saving} style={{ ...primaryButtonStyle, width: "auto" }}>
                    {saving ? "..." : "Save to Project"}
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
                    <td style={{ padding: "8px 10px", fontWeight: 400 }}>20&apos; Sticks</td>
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
                  <span>20&apos; Sticks:</span>
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
                * Includes lapped 20&apos; sticks ({rebarConstants.find(r => r.size === rebarSize)?.overlap}&apos; overlap).
              </div>

              <div style={{ padding: "16px", borderTop: "1px solid #ddd", background: "#f0f9ff" }}>
                <label style={labelStyle}>Save Rebar Breakdown</label>
                <div style={{ display: "flex", gap: "8px" }}>
                  <input 
                    placeholder="e.g. Building 2 Slab..." 
                    value={rebarCalcName} 
                    onChange={e => setRebarCalcName(e.target.value)} 
                    onKeyDown={e => e.key === "Enter" && handleSaveRebar()}
                    style={{ ...inputStyle, marginBottom: 0 }} 
                  />
                  <button onClick={handleSaveRebar} disabled={saving} style={{ ...primaryButtonStyle, width: "auto", background: "#0369a1" }}>
                    {saving ? "..." : "Save to Project"}
                  </button>
                </div>
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
                      <span style={{ fontSize: "14px", color: "#666" }}>Sticks (20&apos;)</span>
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

              <div style={{ padding: "16px", borderTop: "1px solid #ddd", background: "#f0f9ff" }}>
                <label style={labelStyle}>Save Footer Breakdown</label>
                <div style={{ display: "flex", gap: "8px" }}>
                  <input 
                    placeholder="e.g. South Wall Footer..." 
                    value={footerCalcName} 
                    onChange={e => setFooterCalcName(e.target.value)} 
                    onKeyDown={e => e.key === "Enter" && handleSaveFooter()}
                    style={{ ...inputStyle, marginBottom: 0 }} 
                  />
                  <button onClick={handleSaveFooter} disabled={saving} style={{ ...primaryButtonStyle, width: "auto", background: "#0369a1" }}>
                    {saving ? "..." : "Save to Project"}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Recent Calculations Sidebar */}
        <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
          {/* Totals Summary Card */}
          <div style={{ ...cardStyle, background: "#15616D", color: "white", borderColor: "#0e4048" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "16px" }}>
              <div style={{ flex: 1 }}>
                <h2 style={{ ...cardTitleStyle, color: "white", marginBottom: "4px" }}>
                  {selectedProjectId ? "Project Totals" : "Global Recent Totals"}
                </h2>
                {selectedProjectId && (
                  <div style={{ fontSize: "12px", color: "rgba(255,255,255,0.7)", fontWeight: 600 }}>
                    {projectsList.find(p => p.id === selectedProjectId)?.projectName}
                  </div>
                )}
              </div>
              <button 
                onClick={downloadBreakdown}
                style={{
                  background: "white",
                  color: "#15616D",
                  border: "none",
                  borderRadius: "6px",
                  padding: "6px 12px",
                  fontSize: "12px",
                  fontWeight: 700,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: "4px"
                }}
              >
                <span>Download Report</span>
              </button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
              <div style={{ background: "rgba(255,255,255,0.1)", padding: "15px", borderRadius: "8px", textAlign: "center" }}>
                <div style={{ fontSize: "10px", opacity: 0.8, textTransform: "uppercase" }}>Conc. Sum</div>
                <div style={{ fontSize: "24px", fontWeight: 800 }}>{aggregateTotals.cy.toFixed(0)} <span style={{ fontSize: "12px", fontWeight: 400 }}>CY</span></div>
              </div>
              <div style={{ background: "rgba(255,255,255,0.1)", padding: "15px", borderRadius: "8px", textAlign: "center" }}>
                <div style={{ fontSize: "10px", opacity: 0.8, textTransform: "uppercase" }}>Rebar Sum</div>
                <div style={{ fontSize: "24px", fontWeight: 800 }}>{aggregateTotals.tons.toFixed(2)} <span style={{ fontSize: "12px", fontWeight: 400 }}>TONS</span></div>
              </div>
            </div>
            <p style={{ fontSize: "10px", marginTop: "12px", opacity: 0.7, fontStyle: "italic" }}>
              {selectedProjectId 
                ? "* Sum of all current estimates for this project." 
                : "* Showing latest 10 estimates globally."}
            </p>
          </div>

          <div style={cardStyle}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "20px" }}>
              <h2 style={{ ...cardTitleStyle, marginBottom: 0 }}>
                {selectedProjectId ? "Project Breakdown" : "Recent Global Entries"}
              </h2>
              <span style={{ fontSize: "11px", color: "#999" }}>Latest per label</span>
            </div>
            {loading ? <p>Loading...</p> : (
              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                {recentCalcs.map(c => (
                  <div key={c.id} style={{ padding: "12px", border: "1px solid #eee", borderRadius: "8px", background: "#f9fafb", position: "relative" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "2px", paddingRight: "60px" }}>
                      <span style={{ fontWeight: 600, color: "#333" }}>{c.label || c.name}</span>
                      <span style={{ fontSize: "10px", color: "#15616D", background: "rgba(21, 97, 109, 0.1)", padding: "2px 6px", borderRadius: "4px", fontWeight: 700 }}>
                        {c.type.toUpperCase()}
                      </span>
                    </div>
                    <div style={{ fontSize: "10px", color: "#999", marginBottom: "6px" }}>
                      {formatTimestamp(c.timestamp)}
                    </div>
                    <button 
                      onClick={() => loadCalculation(c)}
                      style={{
                        position: "absolute",
                        top: "12px",
                        right: "12px",
                        background: "#15616D",
                        color: "white",
                        border: "none",
                        borderRadius: "4px",
                        padding: "4px 8px",
                        fontSize: "11px",
                        fontWeight: 700,
                        cursor: "pointer"
                      }}
                    >
                      LOAD
                    </button>
                    <div style={{ fontSize: "13px", color: "#15616D", fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {c.projectName}
                    </div>
                    
                    {/* Primary Result Highlight */}
                    <div style={{ fontSize: "18px", fontWeight: 700, color: "#15616D", marginTop: "2px" }}>
                      {c.result}
                    </div>

                    {/* Secondary Dual-Metric Row */}
                    <div style={{ display: "flex", gap: "12px", marginTop: "6px", borderTop: "1px solid #eee", paddingTop: "6px" }}>
                      <div style={{ fontSize: "11px" }}>
                        <span style={{ color: "#666", textTransform: "uppercase", fontSize: "10px", fontWeight: 600 }}>Concrete: </span>
                        <span style={{ fontWeight: 700, color: "#333" }}>{(c.totalCY || 0).toFixed(0)} CY</span>
                      </div>
                      <div style={{ fontSize: "11px" }}>
                        <span style={{ color: "#666", textTransform: "uppercase", fontSize: "10px", fontWeight: 600 }}>Rebar: </span>
                        <span style={{ fontWeight: 700, color: "#333" }}>{(c.totalTons || 0).toFixed(2)} T</span>
                      </div>
                    </div>

                    {/* Details Tooltip/Small text */}
                    <div style={{ fontSize: "10px", color: "#888", marginTop: "4px", fontStyle: "italic" }}>
                    {(c.type === "Pier" || c.type === "Concrete") && c.inputs && (
                      <>
                        {c.inputs.length || c.inputs.diameter}&apos; x {c.inputs.width || c.inputs.diameter}&apos; x {c.inputs.height || c.inputs.depth}&apos; 
                        ({c.inputs.quantity || 1} pcs)
                      </>
                    )}
                      {c.type === "Rebar" && c.inputs && (
                        <>{c.inputs.length}&apos;x{c.inputs.width}&apos; grid @ {c.inputs.spacing}&quot; o.c.</>
                      )}
                      {c.type === "Footer" && c.inputs && (
                        <>{c.inputs.lf}&apos; LF, {c.inputs.width}&apos; wide ({c.inputs.waste || 10}% waste)</>
                      )}
                    </div>
                  </div>
                ))}
                {recentCalcs.length === 0 && <p style={{ color: "#999", fontSize: "14px" }}>No saved calculations yet.</p>}
              </div>
            )}
          </div>
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
const inputStyle = { width: "100%", padding: "10px", border: "1px solid #ddd", borderRadius: "8px", fontSize: "16px", marginBottom: "8px", color: "#333" };
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
