import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "iWantU - AI能力供需平台",
  description:
    "iWantU 连接 AI 需求方与 AI 能力方，帮助企业发布需求、匹配产品、筛选公司、启动 POC 与采购沟通。",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className="h-full antialiased">
      <body className="min-h-screen flex flex-col bg-background text-foreground">
        {children}
      </body>
    </html>
  );
}
