import type { ReactNode } from 'react';
import type { GuideBlock, GuideSection } from '@/lib/helpGuides/types.ts';
import { parseInline } from '@/lib/helpGuides/inline.ts';

export function InlineText({ text }: { text: string }) {
  return (
    <>
      {parseInline(text).map((segment, index) => {
        switch (segment.kind) {
          case 'bold':
            return <strong key={index}>{segment.value}</strong>;
          case 'em':
            return <em key={index}>{segment.value}</em>;
          case 'code':
            return <code key={index} className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[12px] text-slate-800">{segment.value}</code>;
          default:
            return <span key={index}>{segment.value}</span>;
        }
      })}
    </>
  );
}

function Bullets({ items }: { items: string[] }) {
  return (
    <ul className="list-disc space-y-1.5 pl-5">
      {items.map((item, index) => <li key={index}><InlineText text={item} /></li>)}
    </ul>
  );
}

function Block({ block }: { block: GuideBlock }) {
  switch (block.type) {
    case 'paragraph':
      return <p><InlineText text={block.text} /></p>;
    case 'bullets':
      return <Bullets items={block.items} />;
    case 'steps':
      return (
        <ol className="space-y-5">
          {block.items.map((step, index) => (
            <li key={index} className="flex gap-4">
              <span className="mt-0.5 flex h-8 w-8 flex-none items-center justify-center rounded-full bg-teal-800 text-sm font-black text-white">{index + 1}</span>
              <div className="min-w-0">
                <div className="font-bold text-slate-900">{step.title}</div>
                <div className="mt-1 text-slate-700">
                  {Array.isArray(step.body) ? <Bullets items={step.body} /> : <InlineText text={step.body} />}
                </div>
              </div>
            </li>
          ))}
        </ol>
      );
    case 'table':
      return (
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-100 text-left text-xs font-black uppercase tracking-wide text-slate-600">
              <tr>
                {block.columns.map((column) => <th key={column} className="px-4 py-2">{column}</th>)}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, rowIndex) => (
                <tr key={rowIndex} className="border-t border-slate-100 align-top">
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex} className={`px-4 py-3 ${cellIndex === 0 ? 'font-bold text-slate-900' : cellIndex === row.length - 1 && row.length > 2 ? 'text-slate-600' : ''}`}>
                      <InlineText text={cell} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case 'callout':
      return (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <div className="text-xs font-black uppercase tracking-wider text-slate-500">{block.title}</div>
          <div className="mt-2 space-y-3">
            {block.blocks.map((inner, index) => <Block key={index} block={inner} />)}
          </div>
        </div>
      );
    case 'columns':
      return (
        <div className="grid gap-4 md:grid-cols-2">
          {block.columns.map((column) => (
            <div key={column.title} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-xs font-black uppercase tracking-wider text-slate-500">{column.title}</div>
              <div className="mt-2"><Bullets items={column.items} /></div>
            </div>
          ))}
        </div>
      );
    default:
      return null;
  }
}

export function GuideSectionCard({ section, children }: { section: GuideSection; children?: ReactNode }) {
  return (
    <section id={section.id} className="scroll-mt-24 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-xl font-black tracking-tight text-slate-900">{section.title}</h2>
      {section.intro && <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-600"><InlineText text={section.intro} /></p>}
      <div className="mt-4 space-y-4 text-sm leading-6 text-slate-700">
        {section.blocks.map((block, index) => <Block key={index} block={block} />)}
        {children}
      </div>
    </section>
  );
}

export function GuideContent({ sections }: { sections: GuideSection[] }) {
  return (
    <>
      {sections.map((section) => <GuideSectionCard key={section.id} section={section} />)}
    </>
  );
}
