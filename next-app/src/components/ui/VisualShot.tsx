'use client';

interface VisualShotProps {
  variant?: string;
  accent?: string;
  label?: string;
  className?: string;
}

const ACCENT_GRADIENTS: Record<string, string> = {
  blue: 'linear-gradient(135deg, #155eef, #7c3aed, #06aed4, #155eef)',
  violet: 'linear-gradient(135deg, #7c3aed, #155eef, #06aed4, #7c3aed)',
  cyan: 'linear-gradient(135deg, #06aed4, #155eef, #7c3aed, #06aed4)',
  green: 'linear-gradient(135deg, #12b76a, #155eef, #06aed4, #12b76a)',
  orange: 'linear-gradient(135deg, #f79009, #7c3aed, #155eef, #f79009)',
  slate: 'linear-gradient(135deg, #334155, #155eef, #7c3aed, #334155)',
};

const BAR_HEIGHTS = [
  { h: 38, delay: '0ms' },
  { h: 64, delay: '280ms' },
  { h: 48, delay: '560ms' },
];

const LINE_WIDTHS = ['100%', '72%', '88%'];

export default function VisualShot({
  variant,
  accent = 'blue',
  label,
  className,
}: VisualShotProps) {
  const gradient = ACCENT_GRADIENTS[accent] ?? ACCENT_GRADIENTS.blue;

  return (
    <div
      className={`relative h-[132px] rounded-[10px] overflow-hidden text-white animate-gradient ${className ?? ''}`}
      style={{
        background: gradient,
        backgroundSize: '260% 260%',
        transform: 'translateZ(0)',
      }}
    >
      {/* Shimmer overlay */}
      <span
        className="absolute inset-0 pointer-events-none animate-shimmer"
        style={{
          background:
            'linear-gradient(90deg, transparent, rgba(255,255,255,.22), transparent)',
        }}
      />

      {/* Scan line overlay */}
      <span
        className="absolute left-0 right-0 top-0 h-[42%] pointer-events-none animate-scan"
        style={{
          background:
            'linear-gradient(180deg, transparent, rgba(255,255,255,.2), transparent)',
        }}
      />

      {/* Window dots */}
      <div className="absolute left-[18px] top-[18px] flex gap-1.5">
        <span className="block w-2 h-2 rounded-full bg-white/76" />
        <span className="block w-2 h-2 rounded-full bg-white/76" />
        <span className="block w-2 h-2 rounded-full bg-white/76" />
      </div>

      {/* Content lines */}
      <div
        className="absolute left-[20px] top-[48px] w-[45%] grid gap-2.5"
        style={{ direction: 'ltr' }}
      >
        {LINE_WIDTHS.map((w, i) => (
          <i
            key={i}
            className="block h-2 rounded-full bg-white/62 origin-left animate-soft-pop"
            style={{
              width: w,
              animationDelay: `${120 + i * 100}ms`,
            }}
          />
        ))}
      </div>

      {/* Bar chart */}
      <div className="absolute right-[22px] bottom-[28px] h-[74px] flex items-end gap-2">
        {BAR_HEIGHTS.map((bar, i) => (
          <b
            key={i}
            className="block w-[22px] rounded-t-[7px] bg-white/72 origin-bottom animate-bar-dance"
            style={{
              height: `${bar.h}px`,
              animationDelay: bar.delay,
            }}
          />
        ))}
      </div>

      {/* Label */}
      {label && (
        <em className="absolute left-[18px] bottom-[14px] not-italic text-xs font-extrabold">
          {label}
        </em>
      )}
    </div>
  );
}
