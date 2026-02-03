import { NextRequest, NextResponse } from 'next/server';
import { initializeApp, getApps } from 'firebase/app';
import { getFirestore, collection, doc, setDoc, getDocs, deleteDoc, query, where } from 'firebase/firestore';
import { firebaseConfig } from '@/firebaseConfig';

// Initialize Firebase
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
const db = getFirestore(app);

export type KPIEntry = {
  id: string;
  year: string;
  month: number;
  monthName: string;
  estimates?: number;
  scheduledSales?: number;
  bidSubmittedSales?: number;
  subs?: number;
  scheduledHours?: number;
  bidSubmittedHours?: number;
  grossProfit?: number;
  cost?: number;
  leadtimes?: number;
  updatedAt: string;
  createdAt: string;
};

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { year, month, monthName, estimates, scheduledSales, bidSubmittedSales, subs, scheduledHours, bidSubmittedHours, grossProfit, cost, leadtimes } = body;

    if (!year || !month) {
      return NextResponse.json({ error: 'year and month are required' }, { status: 400 });
    }

    const id = `${year}-${String(month).padStart(2, '0')}`;
    const docRef = doc(db, 'kpi', id);
    
    await setDoc(docRef, {
      year,
      month,
      monthName,
      estimates: estimates !== undefined ? Number(estimates) : undefined,
      scheduledSales: scheduledSales !== undefined ? Number(scheduledSales) : undefined,
      bidSubmittedSales: bidSubmittedSales !== undefined ? Number(bidSubmittedSales) : undefined,
      subs: subs !== undefined ? Number(subs) : undefined,
      scheduledHours: scheduledHours !== undefined ? Number(scheduledHours) : undefined,
      bidSubmittedHours: bidSubmittedHours !== undefined ? Number(bidSubmittedHours) : undefined,
      grossProfit: grossProfit !== undefined ? Number(grossProfit) : undefined,
      cost: cost !== undefined ? Number(cost) : undefined,
      leadtimes: leadtimes !== undefined ? Number(leadtimes) : undefined,
      updatedAt: new Date().toISOString(),
    }, { merge: true });

    return NextResponse.json({ success: true, id });
  } catch (error) {
    console.error('Error saving KPI:', error);
    return NextResponse.json({ error: 'Failed to save KPI' }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const year = searchParams.get('year');

    const kpiCollection = collection(db, 'kpi');
    let kpiQuery = year 
      ? query(kpiCollection, where('year', '==', year))
      : kpiCollection;

    const querySnapshot = await getDocs(kpiQuery);
    const kpis = querySnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
    })) as KPIEntry[];

    return NextResponse.json({ data: kpis });
  } catch (error) {
    console.error('Error retrieving KPI:', error);
    return NextResponse.json({ error: 'Failed to retrieve KPI' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json();
    const { id } = body;

    if (!id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }

    const docRef = doc(db, 'kpi', id);
    await deleteDoc(docRef);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting KPI:', error);
    return NextResponse.json({ error: 'Failed to delete KPI' }, { status: 500 });
  }
}
