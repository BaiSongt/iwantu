interface SectionTitleProps {
  title: string;
  desc?: string;
}

export default function SectionTitle({ title, desc }: SectionTitleProps) {
  return (
    <div className="mt-14 mb-5">
      <h2 className="m-0 text-[28px]">{title}</h2>
      {desc && <p className="m-0 mt-2 text-muted leading-relaxed">{desc}</p>}
    </div>
  );
}
