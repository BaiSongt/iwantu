export default function DashboardLoading() {
  return (
    <div>
      {/* Welcome header skeleton */}
      <div className="mb-6">
        <div className="h-8 w-40 animate-pulse rounded-lg bg-muted/20" />
        <div className="mt-2 h-4 w-64 animate-pulse rounded bg-muted/15" />
      </div>

      {/* Stat cards skeleton */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="rounded-2xl border border-line bg-white p-5 shadow-[0_8px_40px_rgba(15,23,42,0.08)]"
          >
            <div className="flex items-center gap-3 mb-3">
              <div className="h-9 w-9 animate-pulse rounded-xl bg-muted/15" />
            </div>
            <div className="h-7 w-16 animate-pulse rounded bg-muted/20" />
            <div className="mt-1 h-3.5 w-20 animate-pulse rounded bg-muted/15" />
          </div>
        ))}
      </div>

      {/* Quick actions skeleton */}
      <div className="mt-6">
        <div className="mb-3 h-5 w-20 animate-pulse rounded bg-muted/20" />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="flex items-center gap-3 rounded-2xl border border-line bg-white px-5 py-4 shadow-[0_8px_40px_rgba(15,23,42,0.08)]"
            >
              <div className="h-9 w-9 animate-pulse rounded-xl bg-muted/15" />
              <div className="h-4 w-20 animate-pulse rounded bg-muted/15" />
            </div>
          ))}
        </div>
      </div>

      {/* Activity sections skeleton */}
      <div className="mt-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main list skeleton */}
        <div className="lg:col-span-2 rounded-2xl border border-line bg-white p-5 shadow-[0_8px_40px_rgba(15,23,42,0.08)]">
          <div className="mb-4 h-5 w-24 animate-pulse rounded bg-muted/20" />
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="flex items-start gap-3 py-3 border-b border-line/60 last:border-0"
            >
              <div className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-muted/30" />
              <div className="flex-1">
                <div className="h-4 w-3/4 animate-pulse rounded bg-muted/15" />
                <div className="mt-1 h-3 w-16 animate-pulse rounded bg-muted/10" />
              </div>
            </div>
          ))}
        </div>

        {/* Side list skeleton */}
        <div className="rounded-2xl border border-line bg-white p-5 shadow-[0_8px_40px_rgba(15,23,42,0.08)]">
          <div className="mb-4 h-5 w-24 animate-pulse rounded bg-muted/20" />
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="flex items-start gap-3 py-3 border-b border-line/60 last:border-0"
            >
              <div className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-muted/30" />
              <div className="flex-1">
                <div className="h-4 w-3/4 animate-pulse rounded bg-muted/15" />
                <div className="mt-1 h-3 w-16 animate-pulse rounded bg-muted/10" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
