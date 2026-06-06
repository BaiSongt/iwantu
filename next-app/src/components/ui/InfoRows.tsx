interface InfoRowsProps {
  rows: [string, string][];
}

export default function InfoRows({ rows }: InfoRowsProps) {
  return (
    <div className="mt-5 border-t border-line">
      {rows.map(([key, value], i) => (
        <p
          key={i}
          className="grid grid-cols-[120px_1fr] gap-4 py-3.5 m-0 border-b border-line"
        >
          <span className="text-muted">{key}</span>
          <strong className="font-bold">{value}</strong>
        </p>
      ))}
    </div>
  );
}
