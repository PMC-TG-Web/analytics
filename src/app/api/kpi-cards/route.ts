import { NextRequest, NextResponse } from 'next/server';
import { initializeApp, getApps } from 'firebase/app';
import { getFirestore, collection, doc, setDoc, getDocs, deleteDoc } from 'firebase/firestore';
import { firebaseConfig } from '@/firebaseConfig';

// Initialize Firebase
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
const db = getFirestore(app);

export type KPICard = {
  id: string;
  cardName: string;
  rows: Array<{
    kpi: string;
    values: string[];
  }>;
  updatedAt: string;
  updatedBy?: string;
};

// GET - Fetch all KPI cards
export async function GET() {
  try {
    const cardsSnapshot = await getDocs(collection(db, 'kpiCards'));
    const cards: KPICard[] = cardsSnapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    })) as KPICard[];

    return NextResponse.json({ success: true, data: cards });
  } catch (error) {
    console.error('Error fetching KPI cards:', error);
    return NextResponse.json({ error: 'Failed to fetch KPI cards' }, { status: 500 });
  }
}

// POST - Create or update a KPI card
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { cardName, rows, updatedBy } = body;

    if (!cardName || !rows) {
      return NextResponse.json(
        { error: 'cardName and rows are required' },
        { status: 400 }
      );
    }

    const cardId = cardName.toLowerCase().replace(/\s+/g, '-');
    const docRef = doc(db, 'kpiCards', cardId);

    const cardData: KPICard = {
      id: cardId,
      cardName,
      rows: rows.map((row: any) => ({
        kpi: row.kpi,
        values: row.values || [],
      })),
      updatedAt: new Date().toISOString(),
      updatedBy: updatedBy || 'system',
    };

    await setDoc(docRef, cardData, { merge: true });

    return NextResponse.json({
      success: true,
      message: 'KPI card updated successfully',
      data: cardData,
    });
  } catch (error) {
    console.error('Error saving KPI card:', error);
    return NextResponse.json({ error: 'Failed to save KPI card' }, { status: 500 });
  }
}

// DELETE - Delete a KPI card
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const cardId = searchParams.get('id');

    if (!cardId) {
      return NextResponse.json({ error: 'Card ID is required' }, { status: 400 });
    }

    await deleteDoc(doc(db, 'kpiCards', cardId));

    return NextResponse.json({ success: true, message: 'KPI card deleted successfully' });
  } catch (error) {
    console.error('Error deleting KPI card:', error);
    return NextResponse.json({ error: 'Failed to delete KPI card' }, { status: 500 });
  }
}
