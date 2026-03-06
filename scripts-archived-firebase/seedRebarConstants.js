const { initializeApp } = require('firebase/app');
const { getFirestore, collection, writeBatch, doc } = require('firebase/firestore');
const firebaseConfig = require('../src/firebaseConfig.json');

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const rebarData = [
  { size: "#3", softMetric: "#10", nominalDiameter: 0.375, weightPerFoot: 0.376, overlap: 1.38 },
  { size: "#4", softMetric: "#13", nominalDiameter: 0.500, weightPerFoot: 0.668, overlap: 1.83 },
  { size: "#5", softMetric: "#16", nominalDiameter: 0.625, weightPerFoot: 1.043, overlap: 2.29 },
  { size: "#6", softMetric: "#19", nominalDiameter: 0.750, weightPerFoot: 1.502, overlap: 2.75 },
  { size: "#7", softMetric: "#22", nominalDiameter: 0.875, weightPerFoot: 2.044, overlap: 3.21 },
  { size: "#8", softMetric: "#25", nominalDiameter: 1.000, weightPerFoot: 2.670, overlap: 3.67 },
  { size: "#9", softMetric: "#29", nominalDiameter: 1.128, weightPerFoot: 3.400, overlap: 4.13 },
  { size: "#10", softMetric: "#32", nominalDiameter: 1.270, weightPerFoot: 4.303, overlap: 4.58 },
  { size: "#11", softMetric: "#36", nominalDiameter: 1.410, weightPerFoot: 5.313, overlap: 5.04 },
  { size: "#14", softMetric: "#43", nominalDiameter: 1.693, weightPerFoot: 7.650, overlap: 6.42 },
  { size: "#18", softMetric: "#57", nominalDiameter: 2.257, weightPerFoot: 13.600, overlap: 8.25 },
];

async function seedRebar() {
  const batch = writeBatch(db);
  const rebarCol = collection(db, "rebarConstants");

  rebarData.forEach((item) => {
    // Using size as ID for easy lookup
    const docRef = doc(rebarCol, item.size.replace("#", "size_"));
    batch.set(docRef, item);
  });

  await batch.commit();
  console.log("Rebar constants seeded successfully!");
  process.exit(0);
}

seedRebar();
