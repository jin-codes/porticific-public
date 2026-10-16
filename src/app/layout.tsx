import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "porticific",
  description: "Portfolio journal with buy theses, analysis and live prices — MCP-native.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body className="min-h-screen bg-white text-neutral-900 antialiased dark:bg-neutral-950 dark:text-neutral-100">{children}</body>
    </html>
  );
}
