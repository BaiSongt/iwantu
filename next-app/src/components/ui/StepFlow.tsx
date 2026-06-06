interface StepFlowProps {
  steps: { label: string; desc: string }[];
}

export default function StepFlow({ steps }: StepFlowProps) {
  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
      {steps.map((step, i) => (
        <article
          key={i}
          className="min-h-[180px] p-5 bg-white border border-line rounded-xl animate-soft-pop transition-all duration-320 ease-out hover:-translate-y-1.5 hover:border-[#bfdbfe] hover:shadow-[0_24px_70px_rgba(21,94,239,0.16)]"
          style={{ animationDelay: `${i * 80}ms` }}
        >
          <span className="grid h-8 w-8 place-items-center rounded-full bg-primary/10 text-primary font-black text-sm">
            {i + 1}
          </span>
          <h3 className="text-lg m-0 mt-3 mb-2">{step.label}</h3>
          <p className="text-muted text-sm m-0 leading-relaxed">{step.desc}</p>
        </article>
      ))}
    </div>
  );
}
