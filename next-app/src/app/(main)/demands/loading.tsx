export default function DemandsLoading() {
  return (
    <div className="mx-auto max-w-7xl px-6 py-10 animate-fade-up">
      {/* Header skeleton */}
      <div className="mb-8">
        <div className="h-8 w-48 animate-pulse rounded-lg bg-muted/20" />
        <div className="mt-2 h-4 w-80 animate-pulse rounded bg-muted/15" />
      </div>

      {/* Metrics skeleton */}
      <div className="mb-8 grid grid-cols-2 gap-4 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="rounded-2xl border border-line bg-white p-5 shadow-[0_8px_40px_rgba(15,23,42,0.08)]"
          >
            <div className="h-7 w-14 animate-pulse rounded bg-muted/20" />
            <div className="mt-2 h-3 w-20 animate-pulse rounded bg-muted/15" />
          </div>
        ))}
      </div>

      {/* Search bar skeleton */}
      <div className="mb-6">
        <div className="h-12 w-full max-w-xl animate-pulse rounded-xl bg-muted/10" />
      </div>

      {/* Sidebar + Content */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Sidebar skeleton */}
        <div className="lg:col-span-1">
          <div className="rounded-2xl border border-line bg-white p-5 shadow-[0_8px_40px_rgba(15,23,42,0.08)]">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="mb-4 last:mb-0">
                <div className="h-3 w-12 animate-pulse rounded bg-muted/20" />
                <div className="mt-2 h-10 w-full animate-pulse rounded-lg bg-muted/10" />
              </div>
            ))}
          </div>
        </div>

        {/* Content skeleton */}
        <div className="lg:col-span-3">
          {/* Toolbar skeleton */}
          <div className="mb-4 flex items-center justify-between">
            <div className="h-5 w-36 animate-pulse rounded bg-muted/15" />
            <div className="h-9 w-24 animate-pulse rounded-xl bg-muted/15" />
          </div>

          {/* Card grid skeleton */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="animate-pulse rounded-2xl border border-line bg-white p-5 shadow-[0_8px_40px_rgba(15,23,42,0.08)]"
              >
                {/* Status badge */}
                <div className="h-5 w-16 rounded-full bg-muted/15" />
                {/* Title */}
                <div className="mt-3 h-5 w-3/4 rounded bg-muted/20" />
                {/* Meta info */}
                <div className="mt-3 flex gap-4">
                  <div className="h-4 w-20 rounded bg-muted/15" />
                  <div className="h-4 w-16 rounded bg-muted/15" />
                </div>
                {/* Bottom row */}
                <div className="mt-4 flex items-center justify-between">
                  <div className="h-4 w-24 rounded bg-muted/15" />
                  <div className="h-8 w-16 rounded-xl bg-muted/15" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
