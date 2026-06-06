'use client';

import Link from 'next/link';

const TOPIC_TAGS = ['工业视觉AI', '科研情报Agent', 'OPC交付团队', '知识库问答'];

export default function FeaturedHero() {
  return (
    <section
      className="relative overflow-hidden rounded-3xl px-8 py-16 lg:px-16 lg:py-24 animate-gradient"
      style={{
        background:
          'linear-gradient(135deg, #0f172a 0%, #1e3a5f 25%, #4c1d95 50%, #0e7490 75%, #0f172a 100%)',
        backgroundSize: '300% 300%',
      }}
    >
      {/* Animated background accents */}
      <div className="absolute top-0 right-0 w-96 h-96 bg-cyan/10 rounded-full blur-3xl" />
      <div className="absolute bottom-0 left-0 w-72 h-72 bg-violet/10 rounded-full blur-3xl" />

      <div className="relative z-10 flex flex-col lg:flex-row items-center gap-12 lg:gap-20">
        {/* Left: text content */}
        <div className="flex-1 max-w-xl text-center lg:text-left">
          <span className="inline-block px-3 py-1 rounded-full bg-white/10 text-cyan text-sm font-medium mb-6">
            精选
          </span>
          <h1 className="text-3xl lg:text-4xl font-bold text-white leading-tight mb-4">
            让企业把 AI 需求讲清楚，找到真正能交付的能力方
          </h1>
          <p className="text-slate-300 text-lg leading-relaxed mb-8">
            iWantU 精选栏目汇集经过平台认证的优秀 AI 产品、Agent 和交付团队，帮助企业快速定位可信赖的 AI 能力合作伙伴。
          </p>
          <div className="flex flex-wrap justify-center lg:justify-start gap-3">
            <Link
              href="/demands/publish"
              className="px-6 py-3 rounded-xl bg-white text-slate-900 font-semibold text-sm hover:bg-slate-100 transition-colors"
            >
              发布需求
            </Link>
            <Link
              href="#featured"
              className="px-6 py-3 rounded-xl border border-white/20 text-white font-semibold text-sm hover:bg-white/10 transition-colors"
            >
              浏览推荐
            </Link>
          </div>
        </div>

        {/* Right: topic tags with float animation */}
        <div className="flex flex-col items-center lg:items-start gap-3">
          {TOPIC_TAGS.map((tag, i) => (
            <div
              key={tag}
              className="px-5 py-3 rounded-2xl bg-white/10 backdrop-blur border border-white/10 text-white text-sm font-medium"
              style={{
                animation: `float ${4 + i * 0.5}s ease-in-out ${i * 0.3}s infinite`,
              }}
            >
              {tag}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
