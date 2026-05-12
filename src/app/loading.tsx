export default function Loading() {
  return (
    <main className="min-h-screen bg-neutral-100 text-slate-900 p-4">
      <div className="mx-auto flex min-h-[50vh] max-w-4xl flex-col items-center justify-center rounded-3xl border border-gray-200 bg-white shadow-sm">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-red-900 border-t-transparent" />
        <p className="mt-4 text-sm font-bold uppercase tracking-wider text-gray-500">Loading page...</p>
      </div>
    </main>
  );
}
