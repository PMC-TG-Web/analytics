// Firebase configuration and initialization
import { initializeApp, getApps } from 'firebase/app';
// Only import getAnalytics in the browser
let analytics: any = null;
let getAnalytics: any = null;
if (typeof window !== 'undefined') {
	// Dynamically import getAnalytics only on the client
	import('firebase/analytics').then(mod => {
		getAnalytics = mod.getAnalytics;
		analytics = getAnalytics(app);
	});
}
import { getFirestore } from 'firebase/firestore';
import { firebaseConfig } from './firebaseConfig';

// Initialize Firebase only once
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
export const firebaseApp = app;
export { analytics };
export const db = getFirestore(app);
