import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

type JobTitleRow = { id: string; title: string };

const defaultTitles = [
  'Field Worker',
  'Project Manager',
  'Superintendent',
  'Foreman',
  'Estimator',
  'Office Staff',
  'Executive',
];

function getStorePath() {
  return path.join(process.cwd(), 'public', 'job-titles.json');
}

function readTitles(): JobTitleRow[] {
  const storePath = getStorePath();
  if (!fs.existsSync(storePath)) {
    return defaultTitles
      .sort((a, b) => a.localeCompare(b))
      .map((title, index) => ({ id: `default-${index + 1}`, title }));
  }

  const raw = fs.readFileSync(storePath, 'utf-8');
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed
    .map((item, index) => ({
      id: typeof item.id === 'string' ? item.id : `row-${index + 1}`,
      title: (item.title || '').toString().trim(),
    }))
    .filter((item) => item.title.length > 0)
    .sort((a, b) => a.title.localeCompare(b.title));
}

function writeTitles(rows: JobTitleRow[]) {
  const storePath = getStorePath();
  fs.writeFileSync(storePath, JSON.stringify(rows, null, 2));
}

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const jobTitles = readTitles();

    return NextResponse.json({
      success: true,
      data: jobTitles,
    });
  } catch (error) {
    console.error('Failed to fetch job titles:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch job titles' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const title = (body?.title || '').toString().trim();

    if (!title) {
      return NextResponse.json(
        { success: false, error: 'title is required' },
        { status: 400 }
      );
    }

    const existingRows = readTitles();
    const existing = existingRows.find((row) => row.title.toLowerCase() === title.toLowerCase());
    if (existing) {
      return NextResponse.json({ success: true, data: existing });
    }

    const created = {
      id: `title-${Date.now()}`,
      title,
    };

    writeTitles([...existingRows, created].sort((a, b) => a.title.localeCompare(b.title)));

    return NextResponse.json({
      success: true,
      data: created,
    });
  } catch (error) {
    console.error('Failed to create job title:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to create job title' },
      { status: 500 }
    );
  }
}
