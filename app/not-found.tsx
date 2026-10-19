import Link from "next/link";

export default function NotFound() {
  return (
    <main className="relative min-h-[calc(100vh-64px)] bg-surface flex flex-col items-center justify-center p-6 text-center">
      <span className="material-symbols-outlined text-outline text-6xl mb-4" aria-hidden="true">search_off</span>
      <h1 className="text-headline-md mb-2">Page not found</h1>
      <p className="text-on-surface-variant mb-6">The page you&apos;re looking for doesn&apos;t exist or has moved.</p>
      <Link href="/markets" className="bg-primary text-white px-6 py-2 rounded-lg font-label-caps uppercase min-h-11 inline-flex items-center">
        Back to markets
      </Link>
    </main>
  );
}
