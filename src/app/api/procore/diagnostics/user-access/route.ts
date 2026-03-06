import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { makeRequest } from "@/lib/procore";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, accessToken: bodyToken } = body;

    const cookieStore = await cookies();
    const token = cookieStore.get('procore_access_token')?.value || bodyToken;
    const companyId = cookieStore.get('procore_company_id')?.value;

    if (!token || !companyId) {
      return NextResponse.json({ error: 'Not authenticated or missing company ID' }, { status: 401 });
    }

    // 1. Find user in Company Directory
    const users = await makeRequest(`/rest/v1.0/companies/${companyId}/users?filters[email]=${email}`, token);
    
    if (!users || users.length === 0) {
      return NextResponse.json({ found: false, message: 'User not found in company directory' });
    }

    const user = users[0];
    const userId = user.id;

    // 2. Get User Details
    const userDetails = await makeRequest(`/rest/v1.0/companies/${companyId}/users/${userId}`, token);

    // 3. Get User Permissions (Company Level)
    const companyPermissions = await makeRequest(`/rest/v1.0/companies/${companyId}/permissions?user_id=${userId}`, token);

    return NextResponse.json({
      found: true,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        is_active: user.is_active,
        job_title: user.job_title
      },
      permissions: {
         company: companyPermissions,
         details: userDetails
      }
    });
  } catch (error) {
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }, { status: 500 });
  }
}
