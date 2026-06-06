'use client';

const ORBIT_NODES = [
  { label: '产品', angle: 0 },
  { label: '需求', angle: 72 },
  { label: 'Agent', angle: 144 },
  { label: '公司', angle: 216 },
  { label: 'POC', angle: 288 },
];

export default function HeroGraphic() {
  return (
    <div
      className="relative w-full min-h-[400px] flex items-center justify-center rounded-3xl overflow-hidden"
      style={{
        background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0f172a 100%)',
      }}
    >
      {/* Decorative orbital ring 1 */}
      <div
        className="absolute w-[320px] h-[320px] rounded-full border border-blue-500/20"
        style={{ animation: 'orbit-glow 20s linear infinite' }}
      />

      {/* Decorative orbital ring 2 */}
      <div
        className="absolute w-[260px] h-[260px] rounded-full border border-violet/20"
        style={{ animation: 'orbit-glow 14s linear infinite reverse' }}
      />

      {/* Orbiting nodes */}
      {ORBIT_NODES.map((node) => (
        <div
          key={node.label}
          className="absolute flex items-center justify-center"
          style={{
            top: '50%',
            left: '50%',
            transform: `rotate(${node.angle}deg) translateY(-150px) rotate(-${node.angle}deg)`,
            animation: `float ${4.5 + node.angle / 100}s ease-in-out ${node.angle / 200}s infinite`,
          }}
        >
          <div className="w-14 h-14 rounded-2xl bg-white flex items-center justify-center text-sm font-semibold text-primary shadow-lg shadow-blue-500/20">
            {node.label}
          </div>
        </div>
      ))}

      {/* Center "U" circle with gradient + pulse-glow */}
      <div className="relative z-10">
        <div
          className="w-24 h-24 rounded-full flex items-center justify-center animate-pulse-glow"
          style={{
            background: 'linear-gradient(135deg, #155eef 0%, #7c3aed 50%, #06aed4 100%)',
          }}
        >
          <span className="text-3xl font-bold text-white tracking-tight">U</span>
        </div>
      </div>

      {/* Caption */}
      <div className="absolute bottom-6 left-6 px-4 py-1.5 rounded-full text-xs text-slate-400 font-medium border border-slate-700">
        AI能力匹配图谱
      </div>
    </div>
  );
}
