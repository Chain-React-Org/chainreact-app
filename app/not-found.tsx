import Link from "next/link"

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center px-6 bg-white dark:bg-slate-950">
      <div className="text-center max-w-md">
        <p className="text-sm font-medium text-orange-500 mb-3">404</p>
        <h1 className="text-3xl font-bold text-slate-900 dark:text-slate-50 mb-3">
          This page doesn’t exist
        </h1>
        <p className="text-sm text-slate-600 dark:text-slate-400 mb-8">
          The link you followed may be broken, or the page may have been removed.
        </p>
        <div className="flex items-center justify-center gap-3">
          <Link
            href="/"
            className="inline-flex items-center h-9 px-4 rounded-md text-sm font-medium bg-gradient-to-r from-orange-500 to-rose-500 text-white hover:from-orange-600 hover:to-rose-600 transition-colors"
          >
            Back to home
          </Link>
          <Link
            href="/support"
            className="inline-flex items-center h-9 px-4 rounded-md text-sm font-medium border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-900 transition-colors"
          >
            Contact support
          </Link>
        </div>
      </div>
    </div>
  )
}
