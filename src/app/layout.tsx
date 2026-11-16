import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { AppShell } from "@/components/shell/AppShell";
import { StorageBoundary } from "@/components/StorageBoundary";

// Platform type families, bundled locally (SIL OFL, see ./fonts/LICENSE-*.txt). No network requests.
const inter = localFont({
  src: "./fonts/inter-latin-wght-normal.woff2",
  weight: "100 900",
  style: "normal",
  display: "swap",
  variable: "--font-inter",
});

const robotoMono = localFont({
  src: [
    { path: "./fonts/roboto-mono-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "./fonts/roboto-mono-latin-500-normal.woff2", weight: "500", style: "normal" },
    { path: "./fonts/roboto-mono-latin-600-normal.woff2", weight: "600", style: "normal" },
  ],
  display: "swap",
  variable: "--font-roboto-mono",
});

const UI_SCALE_SCRIPT = `try{var s=localStorage.getItem("helferlein:ui-scale");if(s==="large"||s==="xlarge")document.documentElement.setAttribute("data-ui-scale",s)}catch(e){}`;

export const metadata: Metadata = {
  title: "Helferlein",
  description: "Lokale Rechnungen und geprüfte E-Rechnungsexporte",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="de" className={`${inter.variable} ${robotoMono.variable}`} suppressHydrationWarning>
      <head>
        {/* The chosen text size applies before the first paint; the app shell keeps this copy in step with the settings. */}
        <script dangerouslySetInnerHTML={{ __html: UI_SCALE_SCRIPT }} />
      </head>
      <body className="min-h-dvh bg-surface font-sans text-ink antialiased">
        <StorageBoundary><AppShell>{children}</AppShell></StorageBoundary>
      </body>
    </html>
  );
}
