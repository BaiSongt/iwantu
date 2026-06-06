import Link from 'next/link';

export default function Footer() {
  return (
    <footer className="flex flex-wrap items-center gap-4 border-t border-line bg-white px-5 py-6 text-sm text-muted md:px-[72px] max-[720px]:items-stretch">
      {/* Logo */}
      <Link href="/" className="flex items-center gap-3 mr-auto">
        <span className="grid h-[30px] w-[30px] place-items-center rounded-lg bg-gradient-to-br from-primary to-violet text-white text-xs font-extrabold">
          U
        </span>
        <strong className="text-foreground text-base tracking-tight">iWantU</strong>
      </Link>

      <span className="hidden sm:inline text-muted">
        AI能力供需平台
      </span>

      {/* Quick Links */}
      <div className="flex items-center gap-3">
        <Link
          href="/demands"
          className="rounded-lg px-3 py-2 font-bold text-sm text-muted transition-colors duration-160 hover:text-primary hover:bg-[#eff6ff]"
        >
          需求方控制台
        </Link>
        <Link
          href="/products"
          className="rounded-lg px-3 py-2 font-bold text-sm text-muted transition-colors duration-160 hover:text-primary hover:bg-[#eff6ff]"
        >
          供应商后台
        </Link>
        <Link
          href="/messages"
          className="rounded-lg px-3 py-2 font-bold text-sm text-muted transition-colors duration-160 hover:text-primary hover:bg-[#eff6ff]"
        >
          站内沟通
        </Link>
      </div>

      {/* Copyright */}
      <span className="w-full text-center text-xs text-muted/60 mt-2">
        &copy; {new Date().getFullYear()} iWantU. All rights reserved.
      </span>
    </footer>
  );
}
