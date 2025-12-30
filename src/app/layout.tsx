import type { Metadata } from "next";
import "./globals.css";
import { AppShell } from "@/components/AppShell";
import { AppBackground } from "@/components/AppBackground";

export const metadata: Metadata = {
  title: "Invoice App",
  description: "Local-first invoice creation and management",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="de">
      <body className="min-h-dvh antialiased relative">
        <AppBackground />
        <div className="relative z-10">
          <AppShell>{children}</AppShell>
        </div>
      </body>
    </html>
  );
}
