'use client';

interface TagCloudProps {
  tags: string[];
}

export default function TagCloud({ tags }: TagCloudProps) {
  return (
    <div className="flex flex-wrap gap-2">
      {tags.map((tag, i) => {
        const isViolet = i % 2 === 1;
        return (
          <span
            key={i}
            className={`inline-flex items-center min-h-[27px] px-2.5 py-1.5 rounded-lg text-xs font-bold animate-soft-pop ${
              isViolet
                ? 'bg-violet/10 text-violet'
                : 'bg-primary/10 text-primary'
            }`}
            style={{ animationDelay: `${i * 34}ms` }}
          >
            {tag}
          </span>
        );
      })}
    </div>
  );
}
