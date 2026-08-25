export function ResultSkeleton() {
  return (
    <div className="overflow-hidden rounded-card border border-line bg-panel">
      <div className="aspect-video w-full animate-pulse bg-raise" />
      <div className="space-y-2 p-2.5">
        <div className="h-3 w-[90%] animate-pulse rounded-full bg-raise" />
        <div className="h-3 w-[60%] animate-pulse rounded-full bg-raise" />
        <div className="h-2.5 w-[40%] animate-pulse rounded-full bg-raise" />
      </div>
    </div>
  );
}

export function ResultSkeletonGrid({ count = 8 }: { count?: number }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-4">
      {Array.from({ length: count }, (_, i) => (
        <ResultSkeleton key={i} />
      ))}
    </div>
  );
}
