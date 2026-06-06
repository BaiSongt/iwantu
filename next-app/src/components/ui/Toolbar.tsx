'use client';

interface ToolbarProps {
  count: string;
  actionLabel: string;
  onAction: () => void;
}

export default function Toolbar({ count, actionLabel, onAction }: ToolbarProps) {
  return (
    <div className="bg-panel border border-line rounded-xl min-h-[72px] flex items-center justify-between px-6 py-4 mb-7 shadow-[0_10px_26px_rgba(15,23,42,0.04)] max-[720px]:flex-col max-[720px]:gap-3 max-[720px]:items-stretch">
      <strong className="text-lg">{count}</strong>
      <div className="flex gap-2.5 max-[720px]:flex-col">
        <button
          onClick={onAction}
          className="rounded-lg bg-primary px-4 py-2.5 font-bold text-sm text-white border-0 transition-all duration-160 ease-out hover:-translate-y-0.5 hover:shadow-[0_14px_32px_rgba(21,94,239,0.24)] max-[720px]:w-full"
        >
          {actionLabel}
        </button>
      </div>
    </div>
  );
}
