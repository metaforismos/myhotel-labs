export function ComingSoon({
  phase,
  title,
  description,
}: {
  phase: string;
  title: string;
  description: string;
}) {
  return (
    <div className="border border-border rounded-md bg-surface px-6 py-10 text-center">
      <span className="inline-block px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide border rounded bg-surface-2 text-text-dim border-border">
        {phase}
      </span>
      <h2 className="text-base font-semibold text-text mt-3">{title}</h2>
      <p className="text-sm text-text-dim mt-2 max-w-xl mx-auto">{description}</p>
    </div>
  );
}
