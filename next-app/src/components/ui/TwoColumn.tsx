import type { ReactNode } from 'react';

interface TwoColumnProps {
  main: ReactNode;
  side: ReactNode;
}

export default function TwoColumn({ main, side }: TwoColumnProps) {
  return (
    <div className="grid grid-cols-1 gap-8 items-start md:grid-cols-[1fr_360px]">
      <div>{main}</div>
      <div>{side}</div>
    </div>
  );
}
