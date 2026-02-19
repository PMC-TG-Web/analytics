// Clear all Procore auth and start fresh
import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  console.log('Clearing all Procore authentication...');
  
  const response = NextResponse.json({ success: true, message: 'Authentication cleared' });
  
  // Delete all related cookies
  response.cookies.delete('procore_access_token');
  response.cookies.delete('procore_refresh_token');
  response.cookies.delete('procore_session');
  
  // Keep auth_session for the app itself
  
  return response;
}
