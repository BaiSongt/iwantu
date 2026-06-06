'use client';

interface TabsProps {
  tabs: string[];
  activeIndex: number;
  onChange: (index: number) => void;
}

export default function Tabs({ tabs, activeIndex, onChange }: TabsProps) {
  return (
    <div className="h-[66px] flex items-center gap-2 px-5 my-12 bg-white border border-line rounded-xl overflow-x-auto">
      {tabs.map((tab, i) => (
        <button
          key={i}
          onClick={() => onChange(i)}
          className={`shrink-0 rounded-lg px-3 py-2.5 font-medium text-sm whitespace-nowrap border-0 bg-transparent cursor-pointer transition-all duration-160 ease-out ${
            i === activeIndex
              ? 'text-primary bg-[#eff6ff]'
              : 'text-muted hover:text-primary hover:bg-[#eff6ff]'
          }`}
        >
          {tab}
        </button>
      ))}
    </div>
  );
}
