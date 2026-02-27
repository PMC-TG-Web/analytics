"use client";

import { useEffect, useState } from "react";
import Navigation from "@/components/Navigation";

import { db, getDocs, collection } from "@/firebase";

export default function TestSchedules() {
  const [schedules, setSchedules] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchSchedules() {
      try {
        const schedulesSnapshot = await getDocs(collection(db, "schedules"));
        const schedulesData = schedulesSnapshot.docs.map((doc: any) => ({
          id: doc.id,
          ...doc.data(),
        }));
        setSchedules(schedulesData);
      } catch (error) {
        console.error("Error fetching schedules:", error);
      } finally {
        setLoading(false);
      }
    }
    fetchSchedules();
  }, []);

  if (loading) return <div style={{ padding: 40 }}>Loading...</div>;

  return (
    <div style={{ padding: 40, fontFamily: "monospace" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, marginBottom: 24 }}>
        <h1 style={{ margin: 0 }}>Schedules Database Contents</h1>
        <Navigation currentPage="test-schedules" />
      </div>
      <p>Total schedules: {schedules.length}</p>
      <hr />
      {schedules.length === 0 ? (
        <p>No schedules found in the database.</p>
      ) : (
        schedules.map((schedule: any) => (
          <div key={schedule.id} style={{ marginBottom: 30, padding: 20, background: "#f5f5f5", borderRadius: 8 }}>
            <div><strong>ID:</strong> {schedule.id}</div>
            <div><strong>Job Key:</strong> {schedule.jobKey}</div>
            <div><strong>Project:</strong> {schedule.projectName}</div>
            <div><strong>Customer:</strong> {schedule.customer}</div>
            <div><strong>Total Hours:</strong> {schedule.totalHours}</div>
            {schedule.status && <div><strong>Status:</strong> {schedule.status}</div>}
            {schedule.allocations && (
              <div>
                <strong>Allocations:</strong>
                <ul>
                  {schedule.allocations.map((alloc: any, idx: number) => (
                    <li key={idx}>{alloc.month}: {alloc.percent}%</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}
