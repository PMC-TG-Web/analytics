import { NextRequest, NextResponse } from 'next/server';
import { initializeApp, getApps } from 'firebase/app';
import { getFirestore, collection, doc, setDoc, getDocs, deleteDoc } from 'firebase/firestore';
import { firebaseConfig } from '@/firebaseConfig';
import { defaultCardData } from '@/lib/kpiCardDefaults';
import { promises as fs } from 'fs';
import path from 'path';

// Initialize Firebase
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
const db = getFirestore(app);

const FIRESTORE_TIMEOUT_MS = 3000;
const KPI_CARDS_PATH = path.join(process.cwd(), 'public', 'kpi-cards.json');

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    promise
      .then((result) => {
        clearTimeout(timer);
        resolve(result);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

// Local file storage helpers
async function readLocalKpiCards(): Promise<KPICard[]> {
  try {
    const fileContent = await fs.readFile(KPI_CARDS_PATH, 'utf-8');
    return JSON.parse(fileContent);
  } catch (error) {
    console.log('[KPI Cards] No local kpi-cards.json found, returning empty array');
    return [];
  }
}

async function writeLocalKpiCards(data: KPICard[]): Promise<void> {
  await fs.writeFile(KPI_CARDS_PATH, JSON.stringify(data, null, 2), 'utf-8');
  console.log('[KPI Cards] Saved to local kpi-cards.json');
}

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

function buildDefaultCards(): KPICard[] {
  const now = new Date().toISOString();
  return defaultCardData.map((card) => ({
    id: card.cardName.toLowerCase().replace(/\s+/g, '-'),
    cardName: card.cardName,
    rows: card.rows,
    updatedAt: now,
    updatedBy: 'fallback-defaults',
  }));
}

// GET - Fetch all KPI cards
export async function GET() {
  try {
    // Try Firebase first with timeout
    try {
      const cardsSnapshot = await withTimeout(
        getDocs(collection(db, 'kpiCards')),
        FIRESTORE_TIMEOUT_MS,
        'getKpiCards'
      );
      const cards: KPICard[] = cardsSnapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      })) as KPICard[];

      if (cards.length === 0) {
        console.log('[KPI Cards] Firestore empty, trying local storage');
        const localCards = await readLocalKpiCards();
        
        if (localCards.length > 0) {
          return NextResponse.json({
            success: true,
            data: localCards,
            source: 'local',
          });
        }
        
        return NextResponse.json({
          success: true,
          data: buildDefaultCards(),
          fallback: true,
          message: 'No KPI cards found in Firestore or local storage. Using defaults.',
        });
      }

      console.log('[KPI Cards] Retrieved from Firebase:', cards.length, 'cards');
      return NextResponse.json({ success: true, data: cards, source: 'firebase' });
    } catch (firebaseError) {
      console.log('[KPI Cards] Firebase failed, using local storage:', firebaseError);
      
      // Use local file storage
      const localCards = await readLocalKpiCards();
      
      if (localCards.length > 0) {
        return NextResponse.json({
          success: true,
          data: localCards,
          source: 'local',
        });
      }
      
      // Fall back to defaults
      return NextResponse.json({
        success: true,
        data: buildDefaultCards(),
        fallback: true,
        message: 'Firestore unavailable. Using local defaults.',
      });
    }
  } catch (error) {
    console.error('[KPI Cards] Error fetching KPI cards:', error);
    return NextResponse.json({
      success: true,
      data: buildDefaultCards(),
      fallback: true,
      message: 'Error loading cards. Using local defaults.',
    });
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

    // Try Firebase first, fall back to local storage
    try {
      const docRef = doc(db, 'kpiCards', cardId);
      await withTimeout(
        setDoc(docRef, cardData, { merge: true }),
        FIRESTORE_TIMEOUT_MS,
        'saveKpiCard'
      );
      console.log('[KPI Cards] Saved to Firebase:', cardId);
    } catch (firebaseError) {
      console.log('[KPI Cards] Firebase save failed, using local storage:', firebaseError);
      
      // Use local file storage
      const localCards = await readLocalKpiCards();
      const existingIndex = localCards.findIndex(c => c.id === cardId);
      
      if (existingIndex >= 0) {
        localCards[existingIndex] = cardData;
      } else {
        localCards.push(cardData);
      }
      
      await writeLocalKpiCards(localCards);
    }

    return NextResponse.json({
      success: true,
      message: 'KPI card updated successfully',
      data: cardData,
    });
  } catch (error) {
    console.error('[KPI Cards] Error saving KPI card:', error);
    return NextResponse.json({ error: 'Failed to save KPI card: ' + (error as Error).message }, { status: 500 });
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

    // Try Firebase first, fall back to local storage
    try {
      await withTimeout(
        deleteDoc(doc(db, 'kpiCards', cardId)),
        FIRESTORE_TIMEOUT_MS,
        'deleteKpiCard'
      );
      console.log('[KPI Cards] Deleted from Firebase:', cardId);
    } catch (firebaseError) {
      console.log('[KPI Cards] Firebase delete failed, using local storage:', firebaseError);
      
      // Use local file storage
      const localCards = await readLocalKpiCards();
      const filteredCards = localCards.filter(c => c.id !== cardId);
      await writeLocalKpiCards(filteredCards);
    }

    return NextResponse.json({ success: true, message: 'KPI card deleted successfully' });
  } catch (error) {
    console.error('[KPI Cards] Error deleting KPI card:', error);
    return NextResponse.json({ error: 'Failed to delete KPI card' }, { status: 500 });
  }
}
