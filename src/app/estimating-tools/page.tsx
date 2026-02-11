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
  type: string; // "Pier", "Spread Footer", "Rebar", "Footer", etc.
  label: string;
  name?: string;
  projectId: string;
  projectName: string;
  customer: string;
  inputs: Record<string, string | number | boolean | undefined>;
  result: string | number;
  summary?: string;
  totalCY?: number;
  totalTons?: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

interface PierResult {
  volume: number;
  formsSF: number;
  verticalLF: number;
  tiesLF: number;
  totalSticks: number;
  weightTons: number;
  weightLbs: number;
}

interface SpreadFooterResult {
  volume: number;
  formsSF: number;
  totalLF: number;
  weightTons: number;
  weightLbs: number;
  sticks: number;
  chairs: number;
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
  const [expandedCard, setExpandedCard] = useState<string | null>(null);
  const [showProjectModal, setShowProjectModal] = useState(false);
  const [pendingSaveData, setPendingSaveData] = useState<{ type: string; label: string; data: any } | null>(null);
  
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
  const [pierResult, setPierResult] = useState<PierResult | null>(null);
  const [pierCalcName, setPierCalcName] = useState("");

  // Spread Footer Calculator State
  const [spreadFooterLength, setSpreadFooterLength] = useState("");
  const [spreadFooterWidth, setSpreadFooterWidth] = useState("");
  const [spreadFooterThickness, setSpreadFooterThickness] = useState("");
  const [spreadFooterQuantity, setSpreadFooterQuantity] = useState("1");
  const [spreadFooterRebarSize, setSpreadFooterRebarSize] = useState("#4");
  const [spreadFooterSpacing, setSpreadFooterSpacing] = useState("12"); // inches
  const [spreadFooterChairsPerFooting, setSpreadFooterChairsPerFooting] = useState("4");
  const [spreadFooterResult, setSpreadFooterResult] = useState<SpreadFooterResult | null>(null);
  const [spreadFooterCalcName, setSpreadFooterCalcName] = useState("");

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
  const [footerResult, setFooterResult] = useState<any | null>(null);

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
        if (!spreadFooterRebarSize || !rData.find(r => r.size === spreadFooterRebarSize)) {
          setSpreadFooterRebarSize(rData[0].size || "#4");
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
          limit(15) // Fetch enough to de-duplicate down to 5
        );
      }
      
      const calcSnapshot = await getDocs(calcQuery);
      const allCalcs = calcSnapshot.docs.map(doc => {
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
      const displayedCalcs = uniqueCalcs.slice(0, selectedProjectId ? 50 : 5);
      setRecentCalcs(displayedCalcs); // Limit global to 5, project to 50

      // Calculate aggregates from the visible set
      const totals = displayedCalcs.reduce((acc, current) => {
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
  }, [selectedProjectId, spreadFooterRebarSize, footerRebarSize]); // Added selectedProjectId to re-fetch when project changes

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

  useEffect(() => {
    if (spreadFooterLength && spreadFooterWidth) {
      const l = parseFloat(spreadFooterLength);
      const w = parseFloat(spreadFooterWidth);
      if (!isNaN(l) && !isNaN(w)) {
        // formula: length * width / 16 + 1 rounded up
        setSpreadFooterChairsPerFooting(Math.ceil((l * w) / 16 + 1).toString());
      }
    }
  }, [spreadFooterLength, spreadFooterWidth]);

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
    const stickLength = Number(constants.find(c => c.name === "Rebar Stick Length")?.value || 20);
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

  const calculateSpreadFooter = React.useCallback(() => {
    const l = parseFloat(spreadFooterLength);
    const w = parseFloat(spreadFooterWidth);
    const t = parseFloat(spreadFooterThickness);
    const qty = parseFloat(spreadFooterQuantity);
    const spacing = parseFloat(spreadFooterSpacing) / 12; // convert to ft
    const chairsPerFooting = parseFloat(spreadFooterChairsPerFooting) || 0;
    const wst = parseFloat(waste) / 100;
    
    if (isNaN(l) || isNaN(w) || isNaN(t) || isNaN(qty)) {
      setSpreadFooterResult(null);
      return;
    }

    // 1. Concrete Volume (CY)
    const volumeCuFt = l * w * t;
    const totalVolumeCY = Math.ceil((volumeCuFt * qty * (1 + wst)) / 27);

    // 2. Form S.F. calculation: Perimeter (ft) * Thickness (ft) * Quantity
    const totalFormsSF = ((l * 2) + (w * 2)) * t * qty;

    // 3. Rebar calculation (Grid)
    const stickLength = Number(constants.find(c => c.name === "Rebar Stick Length")?.value || 20);
    const rebarSpec = rebarConstants.find(r => r.size?.toString().trim() === spreadFooterRebarSize?.toString().trim());
    
    let totalLF = 0;
    let weightLbs = 0;
    let sticks = 0;
    const chairs = chairsPerFooting * qty;

    if (rebarSpec && spacing > 0) {
      // Rebar runs in Length direction (spaced across width)
      const rowsL = Math.floor(w / spacing) + 1;
      const feetL = rowsL * l;

      // Rebar runs in Width direction (spaced across length)
      const rowsW = Math.floor(l / spacing) + 1;
      const feetW = rowsW * w;

      totalLF = (feetL + feetW) * qty;
      weightLbs = totalLF * (rebarSpec.weightPerFoot || 0);
      sticks = Math.ceil(totalLF / stickLength);
    }
    
    setSpreadFooterResult({
      volume: totalVolumeCY,
      formsSF: totalFormsSF,
      totalLF,
      weightTons: weightLbs / 2000,
      weightLbs,
      sticks,
      chairs
    });
  }, [
    spreadFooterLength, spreadFooterWidth, spreadFooterThickness, spreadFooterQuantity, 
    spreadFooterSpacing, spreadFooterRebarSize, spreadFooterChairsPerFooting, waste, constants, rebarConstants
  ]);

  const calculateFooter = React.useCallback(() => {
    const lf = parseFloat(footerLF);
    const w = parseFloat(footerWidth);
    const h = parseFloat(footerHeight);
    const rebarCount = parseInt(footerRebarCount);
    
    // Load constants from state
    const stickLength = Number(constants.find(c => c.name === "Rebar Stick Length")?.value || 20);
    const endsCount = Number(constants.find(c => c.name === "Ends")?.value || 2);
    const cornerDowelMult = Number(constants.find(c => c.name === "Corner Dowels")?.value || 1);
    const pierDowelMult = Number(constants.find(c => c.name === "Pier Dowels")?.value || 2);

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
    calculateSpreadFooter();
  }, [calculateSpreadFooter]);

  useEffect(() => {
    calculateFooter();
  }, [calculateFooter]);

  const saveCalculation = async (type: string, label: string, data: { inputs: Record<string, unknown>; result: string; summary?: string; totalCY?: number; totalTons?: number }, overrideProjectId?: string) => {
    const projectIdToUse = overrideProjectId || selectedProjectId;

    if (!projectIdToUse) {
      setPendingSaveData({ type, label, data });
      setShowProjectModal(true);
      return;
    }
    if (!label) {
      alert("Please enter a name/label for this calculation.");
      return;
    }

    const project = projectsList.find(p => p.id === projectIdToUse);
    
    setSaving(true);
    try {
      await addDoc(collection(db, "savedCalculations"), {
        projectName: project?.projectName || "Unknown",
        projectId: projectIdToUse,
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
      setPendingSaveData(null);
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

  const handleSaveSpreadFooter = () => {
    saveCalculation("Spread Footer", spreadFooterCalcName, {
      inputs: { 
        length: spreadFooterLength, 
        width: spreadFooterWidth, 
        thickness: spreadFooterThickness,
        quantity: spreadFooterQuantity,
        rebarSize: spreadFooterRebarSize,
        spacing: spreadFooterSpacing,
        chairsPerFooting: spreadFooterChairsPerFooting,
        waste,
        label: spreadFooterCalcName 
      },
      result: `${spreadFooterResult?.sticks} sticks`,
      summary: `${spreadFooterResult?.volume} CY, ${spreadFooterResult?.formsSF?.toFixed(0)} SF Form, ${spreadFooterResult?.weightTons.toFixed(2)} tons rebar, ${spreadFooterResult?.chairs} chairs`,
      totalCY: spreadFooterResult?.volume || 0,
      totalTons: spreadFooterResult?.weightTons || 0
    });
    setSpreadFooterCalcName("");
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

  const renderTotalsCard = (isFloating = false) => (
    <div style={{ 
      ...cardStyle, 
      background: "#15616D", 
      color: "white", 
      borderColor: "#0e4048",
      ...(isFloating ? { boxShadow: "0 10px 25px rgba(0,0,0,0.2)" } : {})
    }}>
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
        {!isFloating && (
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
        )}
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
          : "* Showing latest 5 estimates globally."}
      </p>
    </div>
  );

  const formatTimestamp = (ts: any) => {
    if (!ts) return "Just now";
    try {
      const date = ts.toDate ? ts.toDate() : new Date(ts);
      return date.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
    } catch {
      return "";
    }
  };

  const loadCalculation = (calc: Calculation) => {
    setSelectedProjectId(calc.projectId);
    
    if (calc.type === "Pier" || calc.type === "Concrete") {
      setPierLength(String(calc.inputs.length || calc.inputs.diameter || ""));
      setPierWidth(String(calc.inputs.width || calc.inputs.diameter || ""));
      setPierHeight(String(calc.inputs.height || calc.inputs.depth || ""));
      setPierDowelLength(String(calc.inputs.dowelLength || ""));
      setPierTieLength(String(calc.inputs.tieLength || ""));
      setPierVerticalCount(String(calc.inputs.verticalCount || "4"));
      setPierVerticalSize(String(calc.inputs.verticalSize || "#4"));
      setPierTiesSpacing(String(calc.inputs.tiesSpacing || "12"));
      setPierExtraTies(String(calc.inputs.extraTies || "3"));
      setPierQuantity(String(calc.inputs.quantity || "1"));
      setWaste(String(calc.inputs.waste || "10"));
      setPierCalcName(String(calc.inputs.label || calc.label || ""));
    } else if (calc.type === "Spread Footer" || calc.type === "Rebar") {
      setSpreadFooterLength(String(calc.inputs.length || ""));
      setSpreadFooterWidth(String(calc.inputs.width || ""));
      setSpreadFooterThickness(String(calc.inputs.thickness || ""));
      setSpreadFooterQuantity(String(calc.inputs.quantity || "1"));
      setSpreadFooterRebarSize(String(calc.inputs.rebarSize || calc.inputs.size || "#4"));
      setSpreadFooterSpacing(String(calc.inputs.spacing || "12"));
      setSpreadFooterChairsPerFooting(String(calc.inputs.chairsPerFooting || "4"));
      setWaste(String(calc.inputs.waste || "10"));
      setSpreadFooterCalcName(String(calc.inputs.label || calc.label || ""));
    } else if (calc.type === "Footer") {
      setFooterLF(String(calc.inputs.lf || ""));
      setFooterWidth(String(calc.inputs.width || ""));
      setFooterHeight(String(calc.inputs.height || ""));
      setFooterRebarCount(String(calc.inputs.rebarCount || "4"));
      setFooterRebarSize(String(calc.inputs.rebarSize || "#4"));
      setFooterHorizontalsSpacing(String(calc.inputs.horizontalsSpacing || "2"));
      setFooterDowelsSpacing(String(calc.inputs.dowelsSpacing || "1"));
      setFooterDowelLength(String(calc.inputs.dowelLength || "1.5"));
      setFooterCornerCount(String(calc.inputs.cornerCount || "0"));
      setFooterPierCount(String(calc.inputs.pierCount || "0"));
      setWaste(String(calc.inputs.waste || "10"));
      setFooterCalcName(String(calc.inputs.label || calc.label || ""));
    }
    
    // Smooth scroll to top
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
        {/* Backdrop for expanded view */}
        {expandedCard && <div style={backdropStyle} onClick={() => setExpandedCard(null)} />}

        {/* Project Selection Modal */}
        {showProjectModal && (
          <div style={{ ...backdropStyle, zIndex: 10000 }} onClick={() => setShowProjectModal(false)}>
            <div 
              style={{
                position: "fixed",
                top: "50%",
                left: "50%",
                transform: "translate(-50%, -50%)",
                background: "white",
                padding: "32px",
                borderRadius: "12px",
                width: "600px",
                maxWidth: "90vw",
                maxHeight: "80vh",
                display: "flex",
                flexDirection: "column",
                boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)",
                zIndex: 10001
              }}
              onClick={e => e.stopPropagation()}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
                <h2 style={{ margin: 0, color: "#15616D" }}>Select Project for Calculation</h2>
                <button 
                  onClick={() => setShowProjectModal(false)}
                  style={{ background: "none", border: "none", fontSize: "24px", cursor: "pointer", color: "#666" }}
                >
                  &times;
                </button>
              </div>
              
              <p style={{ fontSize: "14px", color: "#666", marginBottom: "16px" }}>
                Please select which project you would like to save this <strong>{pendingSaveData?.type}</strong> calculation ({pendingSaveData?.label}) to:
              </p>

              <input 
                placeholder="Search projects by name, customer, or number..." 
                value={projectSearch}
                onChange={e => setProjectSearch(e.target.value)}
                style={{ ...inputStyle, marginBottom: "16px", background: "#f8f9fa" }}
                autoFocus
              />

              <div style={{ flex: 1, overflowY: "auto", border: "1px solid #eee", borderRadius: "8px" }}>
                {projectsList
                  .filter(p => {
                    if (!projectSearch) return true;
                    const search = projectSearch.toLowerCase();
                    return (p.projectName || "").toLowerCase().includes(search) || 
                           (p.customer || "").toLowerCase().includes(search) || 
                           (p.projectNumber || "").toLowerCase().includes(search);
                  })
                  .slice(0, 50) // Limit displayed results for performance
                  .map(p => (
                    <div 
                      key={p.id}
                      onClick={() => {
                        setSelectedProjectId(p.id);
                        setShowProjectModal(false);
                        window.scrollTo({ top: 0, behavior: "smooth" });
                        if (pendingSaveData) {
                          saveCalculation(pendingSaveData.type, pendingSaveData.label, pendingSaveData.data, p.id);
                        }
                      }}
                      style={{
                        padding: "16px",
                        borderBottom: "1px solid #eee",
                        cursor: "pointer",
                        transition: "background 0.2s"
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = "#f0f9ff"}
                      onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start" }}>
                        <div>
                          <div style={{ fontWeight: 800, fontSize: "14px", color: "#15616D" }}>{p.projectName}</div>
                          <div style={{ fontSize: "12px", color: "#666" }}>{p.customer}</div>
                        </div>
                        <div style={{ fontSize: "11px", background: "#eee", padding: "2px 6px", borderRadius: "4px", color: "#666", fontWeight: 700 }}>
                          {p.projectNumber}
                        </div>
                      </div>
                    </div>
                  ))
                }
              </div>
              
              <div style={{ marginTop: "20px", display: "flex", justifyContent: "flex-end" }}>
                <button 
                  onClick={() => setShowProjectModal(false)}
                  style={{ 
                    padding: "10px 20px", 
                    background: "#f3f4f6", 
                    color: "#374151", 
                    border: "none", 
                    borderRadius: "6px", 
                    fontWeight: 600, 
                    cursor: "pointer" 
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Piers Calculator Card */}
        <div 
          style={expandedCard === 'piers' ? expandedCardStyle : { ...cardStyle, position: "relative", cursor: !expandedCard ? "pointer" : "default" }}
          onClick={() => !expandedCard && setExpandedCard('piers')}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
            <h2 style={{ ...cardTitleStyle, marginBottom: 0 }}>Advanced Piers Calculator</h2>
            <div style={{ display: "flex", gap: "8px" }}>
              {expandedCard === 'piers' && (
                <button 
                  onClick={(e) => { e.stopPropagation(); setExpandedCard(null); }}
                  style={{ background: "#666", color: "white", border: "none", borderRadius: "4px", padding: "4px 12px", fontSize: "12px", cursor: "pointer" }}
                >
                  Close &times;
                </button>
              )}
            </div>
          </div>
          
          <div style={{ display: "grid", gridTemplateColumns: expandedCard === 'piers' ? "1fr 1fr 1fr" : "1fr 1fr", gap: "12px", marginBottom: "16px" }}>
            <div style={{ gridColumn: expandedCard === 'piers' ? "span 3" : "span 2", borderBottom: "1px solid #eee", paddingBottom: "10px", marginBottom: "10px" }}>
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

            <div style={{ gridColumn: expandedCard === 'piers' ? "span 3" : "span 2", borderBottom: "1px solid #eee", paddingBottom: "10px", margin: "10px 0" }}>
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

        {/* Spread Footer Calculator Card */}
        <div 
          style={expandedCard === 'spread' ? expandedCardStyle : { ...cardStyle, position: "relative", cursor: !expandedCard ? "pointer" : "default" }}
          onClick={() => !expandedCard && setExpandedCard('spread')}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
            <h2 style={{ ...cardTitleStyle, marginBottom: 0 }}>Spread Footer Calculator</h2>
            <div style={{ display: "flex", gap: "8px" }}>
              {expandedCard === 'spread' && (
                <button 
                  onClick={(e) => { e.stopPropagation(); setExpandedCard(null); }}
                  style={{ background: "#666", color: "white", border: "none", borderRadius: "4px", padding: "4px 12px", fontSize: "12px", cursor: "pointer" }}
                >
                  Close &times;
                </button>
              )}
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: expandedCard === 'spread' ? "1fr 1fr 1fr" : "1fr 1fr", gap: "12px", marginBottom: "16px" }}>
            <div style={{ gridColumn: expandedCard === 'spread' ? "span 3" : "span 2", borderBottom: "1px solid #eee", paddingBottom: "10px", marginBottom: "10px" }}>
              <span style={{ fontSize: "12px", fontWeight: 700, color: "#15616D" }}>FOOTER DIMENSIONS (FEET)</span>
            </div>
            <div>
              <label style={labelStyle}>Length (FT)</label>
              <input type="number" value={spreadFooterLength} onChange={e => setSpreadFooterLength(e.target.value)} style={inputStyle} placeholder="2" />
            </div>
            <div>
              <label style={labelStyle}>Width (FT)</label>
              <input type="number" value={spreadFooterWidth} onChange={e => setSpreadFooterWidth(e.target.value)} style={inputStyle} placeholder="2" />
            </div>
            <div>
              <label style={labelStyle}>Thickness (FT)</label>
              <input type="number" value={spreadFooterThickness} onChange={e => setSpreadFooterThickness(e.target.value)} style={inputStyle} placeholder="1" />
            </div>
            <div>
              <label style={labelStyle}>Total Footers</label>
              <input type="number" value={spreadFooterQuantity} onChange={e => setSpreadFooterQuantity(e.target.value)} style={inputStyle} placeholder="1" />
            </div>

            <div style={{ gridColumn: expandedCard === 'spread' ? "span 3" : "span 2", borderBottom: "1px solid #eee", paddingBottom: "10px", margin: "10px 0" }}>
              <span style={{ fontSize: "12px", fontWeight: 700, color: "#15616D" }}>REINFORCEMENT</span>
            </div>

            <div>
              <label style={labelStyle}>Rebar Size</label>
              <select 
                value={spreadFooterRebarSize} 
                onChange={e => setSpreadFooterRebarSize(e.target.value)} 
                style={{...inputStyle, background: "#fff", cursor: "pointer"}}
              >
                {rebarConstants.map(r => (
                  <option key={r.id || r.size} value={r.size}>{r.size} ({r.weightPerFoot} lbs/ft)</option>
                ))}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Spacing (in o.c.)</label>
              <input type="number" value={spreadFooterSpacing} onChange={e => setSpreadFooterSpacing(e.target.value)} style={inputStyle} placeholder="12" />
            </div>
            <div>
              <label style={labelStyle}>Chairs per Footing</label>
              <input type="number" value={spreadFooterChairsPerFooting} onChange={e => setSpreadFooterChairsPerFooting(e.target.value)} style={inputStyle} placeholder="4" />
            </div>

            <div style={{ gridColumn: expandedCard === 'spread' ? "span 3" : "span 2" }}>
              <label style={labelStyle}>Waste (%)</label>
              <input type="number" value={waste} onChange={e => setWaste(e.target.value)} style={inputStyle} placeholder="10" />
            </div>
          </div>
          
          <p style={{ fontSize: "12px", color: "#666", marginBottom: "12px" }}>
            Calculates concrete volume, form square footage, and a bottom rebar mat for spread footers.
          </p>

          {spreadFooterResult !== null && (
            <div style={{ marginTop: "12px" }}>
              {/* Results Summary */}
              <div style={{ background: "#f8f9fa", borderRadius: "8px", border: "1px solid #0369a1", padding: "16px", marginBottom: "16px" }}>
                <div style={{ fontSize: "12px", fontWeight: 700, color: "#0369a1", textTransform: "uppercase", marginBottom: "12px" }}>Spread Footer Summary</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
                  <div>
                    <div style={{ fontSize: "10px", color: "#666", textTransform: "uppercase" }}>Concrete Volume</div>
                    <div style={{ fontSize: "24px", fontWeight: 800, color: "#0369a1" }}>{spreadFooterResult.volume} <span style={{ fontSize: "12px" }}>CY</span></div>
                  </div>
                  <div>
                    <div style={{ fontSize: "10px", color: "#666", textTransform: "uppercase" }}>Rebar Weight</div>
                    <div style={{ fontSize: "24px", fontWeight: 800, color: "#0369a1" }}>{spreadFooterResult.weightTons.toFixed(2)} <span style={{ fontSize: "12px" }}>TONS</span></div>
                  </div>
                  <div style={{ borderTop: "1px solid #ddd", paddingTop: "8px" }}>
                    <div style={{ fontSize: "10px", color: "#666", textTransform: "uppercase" }}>Form Area</div>
                    <div style={{ fontSize: "18px", fontWeight: 700 }}>{spreadFooterResult.formsSF.toFixed(0)} <span style={{ fontSize: "12px" }}>S.F.</span></div>
                  </div>
                  <div style={{ borderTop: "1px solid #ddd", paddingTop: "8px" }}>
                    <div style={{ fontSize: "10px", color: "#666", textTransform: "uppercase" }}>20&apos; Sticks</div>
                    <div style={{ fontSize: "18px", fontWeight: 700 }}>{spreadFooterResult.sticks} <span style={{ fontSize: "12px" }}>PCS</span></div>
                  </div>
                  <div style={{ borderTop: "1px solid #ddd", paddingTop: "8px" }}>
                    <div style={{ fontSize: "10px", color: "#666", textTransform: "uppercase" }}>Total LF</div>
                    <div style={{ fontSize: "18px", fontWeight: 700 }}>{spreadFooterResult.totalLF.toFixed(0)} <span style={{ fontSize: "12px" }}>FT</span></div>
                  </div>
                  <div style={{ borderTop: "1px solid #ddd", paddingTop: "8px" }}>
                    <div style={{ fontSize: "10px", color: "#666", textTransform: "uppercase" }}>Chairs</div>
                    <div style={{ fontSize: "18px", fontWeight: 700 }}>{spreadFooterResult.chairs} <span style={{ fontSize: "12px" }}>PCS</span></div>
                  </div>
                </div>
              </div>

              <div style={{ padding: "16px", borderTop: "1px solid #ddd", background: "#f0f9ff" }}>
                <label style={labelStyle}>Save Footer Breakdown</label>
                <div style={{ display: "flex", gap: "8px" }}>
                  <input 
                    placeholder="e.g. Pad Footers F1..." 
                    value={spreadFooterCalcName} 
                    onChange={e => setSpreadFooterCalcName(e.target.value)} 
                    onKeyDown={e => e.key === "Enter" && handleSaveSpreadFooter()}
                    style={{ ...inputStyle, marginBottom: 0 }} 
                  />
                  <button onClick={handleSaveSpreadFooter} disabled={saving} style={{ ...primaryButtonStyle, width: "auto", background: "#0369a1" }}>
                    {saving ? "..." : "Save to Project"}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Continuous Footer Calculator Card */}
        <div 
          style={expandedCard === 'footer' ? expandedCardStyle : { ...cardStyle, position: "relative", cursor: !expandedCard ? "pointer" : "default" }}
          onClick={() => !expandedCard && setExpandedCard('footer')}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
            <h2 style={{ ...cardTitleStyle, marginBottom: 0 }}>Advanced Continuous Footer Calculator</h2>
            <div style={{ display: "flex", gap: "8px" }}>
              {expandedCard === 'footer' && (
                <button 
                  onClick={(e) => { e.stopPropagation(); setExpandedCard(null); }}
                  style={{ background: "#666", color: "white", border: "none", borderRadius: "4px", padding: "4px 12px", fontSize: "12px", cursor: "pointer" }}
                >
                  Close &times;
                </button>
              )}
            </div>
          </div>
          
          <div style={{ display: "grid", gridTemplateColumns: expandedCard === 'footer' ? "1fr 1fr 1fr" : "1fr 1fr", gap: "12px", marginBottom: "16px" }}>
            <div style={{ gridColumn: expandedCard === 'footer' ? "span 3" : "span 2", borderBottom: "1px solid #eee", paddingBottom: "10px", marginBottom: "10px" }}>
              <span style={{ fontSize: "12px", fontWeight: 700, color: "#15616D" }}>DIMENSIONS (FEET)</span>
            </div>
            
            <div style={{ gridColumn: expandedCard === 'footer' ? "span 3" : "span 2" }}>
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

            <div style={{ gridColumn: expandedCard === 'footer' ? "span 3" : "span 2", borderBottom: "1px solid #eee", paddingBottom: "10px", margin: "10px 0" }}>
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
          {renderTotalsCard()}

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

      {expandedCard && (
        <div style={{
          position: "fixed",
          top: "40px",
          right: "40px",
          width: "calc(33vw - 60px)",
          zIndex: 1100
        }}>
          {renderTotalsCard(true)}
        </div>
      )}
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

const expandedCardStyle: React.CSSProperties = {
  position: "fixed",
  top: "40px",
  left: "40px",
  width: "calc(66vw - 60px)",
  height: "calc(100vh - 80px)",
  zIndex: 1100,
  overflowY: "auto",
  background: "#fff",
  borderRadius: "16px",
  padding: "32px",
  boxShadow: "0 20px 50px rgba(0,0,0,0.15)",
  border: "1px solid #ddd",
};

const backdropStyle: React.CSSProperties = {
  position: "fixed",
  top: 0,
  left: 0,
  width: "100vw",
  height: "100vh",
  background: "rgba(255,255,255,0.8)",
  backdropFilter: "blur(4px)",
  zIndex: 1000,
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
