export default function ProductsLoading() {
  return (
    <section className="mx-auto max-w-7xl px-6 py-10 animate-fade-up">
      {/* Page header skeleton */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <div className="h-7 w-7 animate-pulse rounded-lg bg-muted/20" />
          <div className="h-8 w-36 animate-pulse rounded-lg bg-muted/20" />
        </div>
        <div className="h-4 w-96 animate-pulse rounded bg-muted/15" />
      </div>

      {/* Search bar skeleton */}
      <div className="mb-6">
        <div className="h-12 w-full max-w-xl animate-pulse rounded-xl bg-muted/10" />
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-1 gap-8 items-start lg:grid-cols-[260px_1fr]">
        {/* Filter sidebar skeleton */}
        <div className="rounded-2xl border border-line bg-white p-5 shadow-[0_8px_40px_rgba(15,23,42,0.08)]">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="mb-4 last:mb-0">
              <div className="h-3 w-16 animate-pulse rounded bg-muted/20" />
              <div className="mt-2 h-10 w-full animate-pulse rounded-lg bg-muted/10" />
            </div>
          ))}
        </div>

        {/* Content area skeleton */}
        <div>
          {/* Toolbar skeleton */}
          <div className="mb-4 flex items-center justify-between">
            <div className="h-5 w-48 animate-pulse rounded bg-muted/15" />
            <div className="h-9 w-24 animate-pulse rounded-xl bg-muted/15" />
          </div>

          {/* Product card grid skeleton */}
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="animate-pulse rounded-2xl border border-line bg-white p-5 shadow-[0_8px_40px_rgba(15,23,42,0.08)]"
              >
                {/* Image placeholder */}
                <div className="h-28 rounded-xl bg-muted/15" />
                {/* Title */}
                <div className="mt-3 h-5 w-3/4 rounded bg-muted/20" />
                {/* Summary */}
                <div className="mt-2 h-3 w-full rounded bg-muted/15" />
                <div className="mt-1 h-3 w-2/3 rounded bg-muted/15" />
                {/* Tags */}
                <div className="mt-3 flex gap-2">
                  <div className="h-5 w-14 rounded-full bg-muted/10" />
                  <div className="h-5 w-14 rounded-full bg-muted/10" />
                  <div className="h-5 w-14 rounded-full bg-muted/10" />
                </div>
                {/* Bottom button */}
                <div className="mt-3 h-8 w-full rounded-xl bg-muted/10" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
