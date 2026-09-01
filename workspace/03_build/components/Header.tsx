import Link from 'next/link';

export function Header() {
  return (
    <header className="sticky top-0 z-10 border-b border-gray-200 bg-white">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
        <Link href="/" className="text-xl font-bold text-gray-900">
          PROTO
        </Link>
        <nav className="flex gap-6 text-sm font-medium text-gray-600">
          <Link href="/" className="hover:text-gray-900">
            Dashboard
          </Link>
          <Link href="/discover" className="hover:text-gray-900">
            Discover Niches
          </Link>
        </nav>
      </div>
    </header>
  );
}
