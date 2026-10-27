import type { Metadata } from "next";
import "./globals.css";
import { AppShell } from "@/components/AppShell";
import { StorageBoundary } from "@/components/StorageBoundary";

export const metadata: Metadata = {
  title: "Helferlein",
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
        <div className="relative z-10">
          <StorageBoundary><AppShell>{children}</AppShell></StorageBoundary>
        </div>
      </body>
    </html>
  );
}
