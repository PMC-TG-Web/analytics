// API endpoint to get current Procore user
import { NextRequest, NextResponse } from 'next/server';
import { makeRequest } from '@/lib/procore';

export async function GET(request: NextRequest) {
  try {
    const accessToken = request.cookies.get('procore_access_token')?.value;

    if (!accessToken) {
      return NextResponse.json(
        { error: 'Not authenticated with Procore' },
        { status: 401 }
      );
    }

    // Get current user info from Procore
    const user = await makeRequest('/rest/v1.0/me', accessToken);

    return NextResponse.json({
      id: user.id,
      email: user.login,
      name: user.name,
      company: user.company
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error fetching Procore user:', errorMessage);
    return NextResponse.json(
      { error: 'Failed to fetch user info' },
      { status: 500 }
    );
  }
}
