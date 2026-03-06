const fs = require('fs');
const path = require('path');
const { initializeApp } = require('firebase/app');
const { getFirestore, collection, doc, setDoc } = require('firebase/firestore');

// Firebase config (prefer env vars, fallback to firebaseConfig.json)
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

const missingConfigKeys = Object.entries(firebaseConfig)
  .filter(([, value]) => !value)
  .map(([key]) => key);

if (missingConfigKeys.length > 0) {
  const configPath = path.join(__dirname, '../src/firebaseConfig.json');
  const fileConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  firebaseConfig.apiKey = fileConfig.apiKey;
  firebaseConfig.authDomain = fileConfig.authDomain;
  firebaseConfig.projectId = fileConfig.projectId;
  firebaseConfig.storageBucket = fileConfig.storageBucket;
  firebaseConfig.messagingSenderId = fileConfig.messagingSenderId;
  firebaseConfig.appId = fileConfig.appId;
}

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// Default KPI card data
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

async function seedKPICards() {
  try {
    console.log('Starting KPI Cards seeding...\n');

    let savedCount = 0;
    for (const cardData of defaultCardData) {
      const cardId = cardData.cardName.toLowerCase().replace(/\s+/g, '-');
      const docData = {
        id: cardId,
        cardName: cardData.cardName,
        rows: cardData.rows,
        updatedAt: new Date().toISOString(),
        updatedBy: 'seed-script',
        createdAt: new Date().toISOString(),
      };

      const docRef = doc(db, 'kpiCards', cardId);
      await setDoc(docRef, docData);
      console.log(`✓ Seeded card: ${cardData.cardName} (${cardData.rows.length} rows)`);
      savedCount++;
    }

    console.log(`\n✓ Successfully seeded ${savedCount} KPI cards to Firestore`);
    console.log('\nYou can now:');
    console.log('  - Visit /kpi to view the KPI page with data from Firestore');
    console.log('  - Visit /kpi-cards-management to edit the cards');
    process.exit(0);
  } catch (error) {
    console.error('Error seeding KPI cards:', error);
    process.exit(1);
  }
}

seedKPICards();
