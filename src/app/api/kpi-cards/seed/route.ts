import { NextRequest, NextResponse } from 'next/server';
import { initializeApp, getApps } from 'firebase/app';
import { getFirestore, doc, setDoc } from 'firebase/firestore';
import { firebaseConfig } from '@/firebaseConfig';
import { defaultCardData } from '@/lib/kpiCardDefaults';

// Initialize Firebase
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
const db = getFirestore(app);


export async function POST(request: NextRequest) {
  try {
    const { seedFromDefaults } = await request.json();

    if (!seedFromDefaults) {
      return NextResponse.json(
        { error: 'seedFromDefaults parameter is required' },
        { status: 400 }
      );
    }

    let seededCount = 0;

    // Note: This endpoint uses client-side Firebase SDK which has limited write permissions
    // For security, ensure Firestore rules allow authenticated writes to kpiCards collection
    for (const card of defaultCardData) {
      const cardId = card.cardName.toLowerCase().replace(/\s+/g, '-');
      const cardData = {
        id: cardId,
        cardName: card.cardName,
        rows: card.rows,
        updatedAt: new Date().toISOString(),
        updatedBy: 'seed-data',
        createdAt: new Date().toISOString(),
      };

      // This will fail if Firestore security rules don't allow it
      // You'll need to temporarily set Firestore rules to allow authenticated writes
      try {
        await setDoc(doc(db, 'kpiCards', cardId), cardData);
        seededCount++;
      } catch (error) {
        console.error(`Error seeding card ${card.cardName}:`, error);
      }
    }

    if (seededCount === 0) {
      return NextResponse.json(
        {
          error: 'Failed to seed data. Check Firestore security rules allow authenticated writes to kpiCards collection.',
          hint: 'Temporarily update Firestore rules to: allow write if request.auth != null; allow read if request.auth != null;'
        },
        { status: 403 }
      );
    }

    return NextResponse.json({
      success: true,
      message: `Successfully seeded ${seededCount} KPI cards to Firestore`,
      seededCards: defaultCardData.map(c => c.cardName),
    });
  } catch (error) {
    console.error('Error seeding KPI cards:', error);
    return NextResponse.json(
      { error: 'Failed to seed KPI cards', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
