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

    // Check if path has unresolved parameters
    if (path.includes(':')) {
      return NextResponse.json({
        success: false,
        path,
        method: method || 'GET',
        statusCode: 400,
        duration: 0,
        responseSize: 0,
        error: 'This endpoint requires URL parameters. Example variables needed: ' + 
          path.match(/:[a-z_]+/gi)?.join(', ') + 
          '. Tests need actual IDs from your Procore account.',
      });
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

    // Calculate response size safely
    let responseSize = 0;
    try {
      responseSize = JSON.stringify(result).length;
    } catch (e) {
      responseSize = 0;
    }

    // Build preview safely
    let preview = {
      isArray: Array.isArray(result),
      itemCount: null as number | null,
      keys: null as string[] | null,
      sample: null as any,
    };

    if (Array.isArray(result) && result.length > 0) {
      preview.itemCount = result.length;
      preview.sample = result[0];
      try {
        preview.keys = Object.keys(result[0]);
      } catch (e) {
        preview.keys = [];
      }
    } else if (result && typeof result === 'object') {
      try {
        preview.keys = Object.keys(result);
        preview.sample = result;
      } catch (e) {
        preview.keys = [];
      }
    }

    return NextResponse.json({
      success: !error,
      path,
      method: method || 'GET',
      statusCode,
      duration,
      responseSize,
      error,
      data: result,
      preview,
    });
  } catch (error) {
    console.error('Error testing endpoint:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        statusCode: 500,
        duration: 0,
        responseSize: 0,
      },
      { status: 500 }
    );
  }
}
