import { NextRequest, NextResponse } from 'next/server';
import { makeRequest } from '@/lib/procore';

export async function POST(request: NextRequest) {
  try {
    const { path, method } = await request.json();

    if (!path) {
      return NextResponse.json(
        { error: 'Path is required' },
        { status: 400 }
      );
    }

    // Get the access token from cookies
    const accessToken = request.cookies.get('procore_access_token')?.value;
    if (!accessToken) {
      return NextResponse.json(
        { error: 'Not authenticated with Procore' },
        { status: 401 }
      );
    }

    const start = Date.now();
    let result: any;
    let statusCode = 200;
    let error: string | null = null;

    try {
      // Make the request using the existing makeRequest function
      result = await makeRequest(path, accessToken);
    } catch (err) {
      error = err instanceof Error ? err.message : 'Unknown error';
      statusCode = 500;
    }

    const duration = Date.now() - start;

    // Calculate response size
    const responseSize = JSON.stringify(result).length;

    return NextResponse.json({
      success: !error,
      path,
      method: method || 'GET',
      statusCode,
      duration,
      responseSize,
      error,
      data: result,
      preview: {
        isArray: Array.isArray(result),
        itemCount: Array.isArray(result) ? result.length : null,
        keys: Array.isArray(result) && result.length > 0 ? Object.keys(result[0]) : (result && typeof result === 'object' ? Object.keys(result) : null),
        sample: Array.isArray(result) ? result[0] : result,
      }
    });
  } catch (error) {
    console.error('Error testing endpoint:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        statusCode: 500
      },
      { status: 500 }
    );
  }
}
