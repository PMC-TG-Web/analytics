import { NextResponse } from 'next/server';
import { collection, addDoc } from 'firebase/firestore';
import { db } from '@/firebase';

export async function GET() {
  try {
    await addDoc(collection(db, 'projects'), {
      "Cost items": "Example Item",
      "CostType": "Material",
      "Hours": 8,
      "LaborCost": 200,
      "LaborSales": 300,
      "Customer": "Acme Corp",
      "Estimator": "John Doe",
      "Status": "Pending",
      "Estimate Price": 1000,
      "Date Updated": "2026-01-14",
      "Date Created": "2026-01-14",
      "Project Number": "P-001",
      "Quantity": 10,
      "Total Cost": 500,
      "Total Sales": 1500,
      "PMC Group": "Group A"
    });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message });
  }
}
