import { NextResponse } from "next/server";
import { db } from "@/firebase";
import { doc, getDoc, setDoc } from "firebase/firestore";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const jobKey = searchParams.get('jobKey');

    if (!jobKey) {
      return NextResponse.json({ success: false, error: 'Missing jobKey' }, { status: 400 });
    }

    const docRef = doc(db, "daySchedules", jobKey);
    const docSnap = await getDoc(docRef);

    if (docSnap.exists()) {
      return NextResponse.json({ success: true, schedule: docSnap.data().schedule || {} });
    } else {
      return NextResponse.json({ success: true, schedule: {} });
    }
  } catch (error) {
    console.error("Error fetching day schedule:", error);
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { jobKey, customer, projectName, schedule } = body;

    if (!jobKey || !schedule) {
      return NextResponse.json({ success: false, error: 'Missing required fields' }, { status: 400 });
    }

    const docRef = doc(db, "daySchedules", jobKey);
    await setDoc(docRef, {
      jobKey,
      customer,
      projectName,
      schedule,
      updatedAt: new Date().toISOString(),
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error saving day schedule:", error);
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}
