import { NextRequest, NextResponse } from 'next/server';
import { initializeApp, getApps } from 'firebase/app';
import { getFirestore, collection, doc, setDoc } from 'firebase/firestore';
import { firebaseConfig } from '@/firebaseConfig';

// Initialize Firebase
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
const db = getFirestore(app);

const defaultCardData = [
  {
    cardName: "Estimates By Month",
    rows: [
      {
        kpi: "Goal",
        values: ["6,700,000", "6,700,000", "6,700,000", "6,700,000", "6,700,000", "6,700,000", "6,700,000", "6,700,000", "6,700,000", "6,700,000", "6,700,000", "6,700,000"]
      },
      {
        kpi: "Goal Hours",
        values: ["29,000", "29,000", "29,000", "29,000", "29,000", "29,000", "29,000", "29,000", "29,000", "29,000", "29,000", "29,000"]
      }
    ]
  },
  {
    cardName: "Sales By Month",
    rows: [
      {
        kpi: "Goal",
        values: ["1,000,000", "1,000,000", "1,000,000", "1,000,000", "1,000,000", "1,000,000", "1,000,000", "1,000,000", "1,000,000", "1,000,000", "1,000,000", "1,000,000"]
      },
      {
        kpi: "Goal Hours",
        values: ["4,331", "4,331", "4,331", "4,331", "4,331", "4,331", "4,331", "4,331", "4,331", "4,331", "4,331", "4,331"]
      }
    ]
  },
  {
    cardName: "Revenue By Month",
    rows: [
      {
        kpi: "Revenue",
        values: ["472,632", "541,918", "776,929", "872,151", "576,090", "661,910", "329,087", "83,061", "69,069", "123,833", "52,156", "39,117"]
      },
      {
        kpi: "Goal",
        values: ["595,680", "794,240", "694,960", "893,520", "1,191,360", "794,240", "893,520", "794,240", "794,240", "893,520", "893,520", "694,960"]
      }
    ]
  },
  {
    cardName: "Subs By Month",
    rows: [
      {
        kpi: "Subcontractor Allowance",
        values: ["83,333", "83,333", "83,333", "83,333", "83,333", "83,333", "83,333", "83,333", "83,333", "83,333", "83,333", "83,333"]
      },
      {
        kpi: "Sub Actual Hours",
        values: ["3,059", "3,391", "4,349", "4,178", "2,478", "2,696", "1,281", "423", "465", "706", "230", "172"]
      }
    ]
  },
  {
    cardName: "Revenue Hours by Month",
    rows: [
      {
        kpi: "Revenue Goal Hours",
        values: ["3,937.5", "3,937.5", "3,937.5", "3,937.5", "3,937.5", "3,937.5", "3,937.5", "3,937.5", "3,937.5", "3,937.5", "3,937.5", "3,937.5"]
      },
      {
        kpi: "Revenue Actual Hours",
        values: ["3,059", "", "", "", "", "", "", "", "", "", "", ""]
      }
    ]
  },
  {
    cardName: "Gross Profit by Month",
    rows: [
      {
        kpi: "GP Goal",
        values: ["31%", "31%", "31%", "31%", "31%", "31%", "31%", "31%", "31%", "31%", "31%", "31%"]
      },
      {
        kpi: "GP Actual",
        values: ["45%", "", "", "", "", "", "", "", "", "", "", ""]
      }
    ]
  },
  {
    cardName: "Profit by Month",
    rows: [
      {
        kpi: "Profit Goal",
        values: ["-4%", "5%", "1%", "8%", "13%", "5%", "8%", "5%", "5%", "8%", "8%", "1%"]
      },
      {
        kpi: "Profit Actual",
        values: ["2%", "", "", "", "", "", "", "", "", "", "", ""]
      }
    ]
  },
  {
    cardName: "Leadtimes by Month",
    rows: [
      {
        kpi: "Leadtime Hours",
        values: ["26,692", "", "", "", "", "", "", "", "", "", "", ""]
      }
    ]
  }
];

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
