"use client";

import { useEffect, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import { db } from "@/firebase";

export default function TestSchedules() {
  const [schedules, setSchedules] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchSchedules() {
      try {
        const schedulesSnapshot = await getDocs(collection(db, "schedules"));
        const schedulesData = schedulesSnapshot.docs.map((doc) => ({
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
      <h1>Schedules Database Contents</h1>
      <p>Total schedules: {schedules.length}</p>
      <hr />
      {schedules.length === 0 ? (
        <p>No schedules found in the database.</p>
      ) : (
        schedules.map((schedule) => (
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
