import { prisma } from '@/lib/prisma';
import { logAuditEvent } from '@/lib/auditLog';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const templates = await prisma.crewTemplate.findMany({
      orderBy: { name: 'asc' },
    });

    // Transform templates to unwrap members field
    const transformedTemplates = templates.map(template => {
      const membersData = template.members as any;
      return {
        ...template,
        crewMemberIds: membersData?.crewMemberIds || membersData || [],
        rightHandManId: membersData?.rightHandManId || null,
        foremanId: membersData?.foremanId || null
      };
    });

    return NextResponse.json({
      success: true,
      data: transformedTemplates,
    });
  } catch (error) {
    console.error('Failed to fetch crew templates:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch crew templates' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, description, members, crewMemberIds, rightHandManId, foremanId } = body;

    if (!name) {
      return NextResponse.json(
        { success: false, error: 'name is required' },
        { status: 400 }
      );
    }

    // Store structured data in members field
    const membersData = {
      crewMemberIds: crewMemberIds || members || [],
      rightHandManId: rightHandManId || null,
      foremanId: foremanId || null
    };

    // Check if a template with this name already exists (upsert behavior)
    const existing = await prisma.crewTemplate.findFirst({
      where: { name }
    });

    let template;
    if (existing) {
      // Update existing template
      template = await prisma.crewTemplate.update({
        where: { id: existing.id },
        data: {
          description: description || null,
          members: membersData,
        },
      });
    } else {
      // Create new template
      template = await prisma.crewTemplate.create({
        data: {
          name,
          description: description || null,
          members: membersData,
        },
      });
    }

    await logAuditEvent(request, {
      action: existing ? 'update' : 'create',
      resource: 'crew-template',
      target: template.id,
      details: {
        name: template.name,
        memberCount: Array.isArray(membersData.crewMemberIds) ? membersData.crewMemberIds.length : 0,
      },
    });

    return NextResponse.json({
      success: true,
      data: template,
    });
  } catch (error) {
    console.error('Failed to create crew template:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to create crew template' },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, name, description, members } = body;

    if (!id) {
      return NextResponse.json(
        { success: false, error: 'id is required' },
        { status: 400 }
      );
    }

    const template = await prisma.crewTemplate.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(description !== undefined && { description: description || null }),
        ...(members !== undefined && { members }),
      },
    });

    await logAuditEvent(request, {
      action: 'update',
      resource: 'crew-template',
      target: template.id,
      details: {
        name: template.name,
        updatedFields: Object.keys(body ?? {}),
      },
    });

    return NextResponse.json({
      success: true,
      data: template,
    });
  } catch (error) {
    console.error('Failed to update crew template:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to update crew template' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json(
        { success: false, error: 'id is required' },
        { status: 400 }
      );
    }

    await prisma.crewTemplate.delete({
      where: { id },
    });

    await logAuditEvent(request, {
      action: 'delete',
      resource: 'crew-template',
      target: id,
    });

    return NextResponse.json({
      success: true,
    });
  } catch (error) {
    console.error('Failed to delete crew template:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to delete crew template' },
      { status: 500 }
    );
  }
}
