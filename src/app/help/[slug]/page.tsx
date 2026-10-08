import Link from 'next/link';
import { notFound } from 'next/navigation';
import { GuideContent } from '@/components/help/GuideContent';
import { getHelpGuide, HELP_GUIDES } from '@/lib/helpGuides';

export const dynamicParams = false;

export function generateStaticParams() {
  return HELP_GUIDES.map((guide) => ({ slug: guide.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const guide = getHelpGuide(slug);
  return { title: guide ? `${guide.title} · Help` : 'Help' };
}

export default async function HelpGuidePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const guide = getHelpGuide(slug);
  if (!guide) notFound();

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6 text-slate-900 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl space-y-5">
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="bg-gradient-to-r from-teal-950 via-teal-900 to-slate-900 px-6 py-6 text-white">
            <div className="mb-2 flex flex-wrap items-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-teal-100">
              <Link href="/help" className="hover:underline">Help</Link>
              <span>/</span>
              <span>{guide.category}</span>
              <span className="rounded-full border border-white/30 px-2.5 py-1">Guide</span>
            </div>
            <h1 className="text-3xl font-black tracking-tight sm:text-4xl">How {guide.pageLabel} works</h1>
            <p className="mt-2 max-w-3xl text-sm text-teal-50/85">{guide.summary}</p>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Link href={guide.pagePath} className="rounded-lg bg-white px-4 py-2 text-sm font-black text-teal-900 shadow-sm transition hover:bg-teal-50">
                Go to {guide.pageLabel} →
              </Link>
              <span className="text-xs text-teal-100">Last reviewed {guide.updated}</span>
            </div>
          </div>
          <nav aria-label="Sections" className="flex flex-wrap gap-x-5 gap-y-2 px-6 py-4 text-sm font-semibold text-teal-800">
            {guide.sections.map((section) => (
              <a key={section.id} href={`#${section.id}`} className="hover:underline">{section.title}</a>
            ))}
          </nav>
        </section>

        <GuideContent sections={guide.sections} />

        <div className="flex flex-wrap justify-between gap-3 px-1 pb-6 text-sm font-semibold text-teal-800">
          <Link href="/help" className="hover:underline">← All help guides</Link>
          <Link href={guide.pagePath} className="hover:underline">Go to {guide.pageLabel} →</Link>
        </div>
      </div>
    </main>
  );
}
