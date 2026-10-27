"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { BreadcrumbChevron, BreadcrumbLink } from "@/components/platform/breadcrumb";
import { TopBar } from "@/components/platform/top-bar";
import { StorageStatus } from "@/components/StorageStatus";
import { usePersistedSettings } from "@/lib/storage/useStore";
import { locate, navAreas } from "./nav";
import { MobileNav } from "./MobileNav";
import { SectionNav } from "./SectionNav";

/*
 * Helferlein chrome after humaify-overwatch `src/components/shell/app-shell.tsx`: the sticky 52px TopBar (product
 * name › path, save status right), the SectionNav row with the areas, the SubNav row with the pages of the active
 * area (only for grouped areas), then a centred 1312px body column. Below md both rows give way to one labelled menu
 * row (MobileNav). No emblem, account menu or environment badge (design-reference, deviation 4).
 */

const CrumbContext = createContext<(label: string | null) => void>(() => {});

/** Lets an object page name itself as the last breadcrumb segment (e.g. the invoice number). */
export function usePageCrumb(label: string | null) {
  const setLabel = useContext(CrumbContext);
  useEffect(() => {
    setLabel(label);
    return () => setLabel(null);
  }, [label, setLabel]);
}

export function AppShell({ children }: { children: ReactNode }) {
  const { settings } = usePersistedSettings();
  const language = settings?.language ?? "de";
  const pathname = usePathname() ?? "";
  const [objectLabel, setObjectLabel] = useState<string | null>(null);
  const areas = useMemo(() => navAreas(language), [language]);
  const { area, page } = locate(areas, pathname);
  const subPages = area?.pages && area.pages.length > 1 ? area.pages : null;
  const atPage = page ? pathname === page.href : false;

  const crumbs: { label: string; href?: string }[] = [];
  if (area && page) {
    if (area.pages && page.key !== area.pages[0]?.key) crumbs.push({ label: area.label, href: area.href });
    crumbs.push({ label: page.label, href: page.href });
  }
  if (objectLabel && !atPage) crumbs.push({ label: objectLabel });

  const de = language === "de";
  return (
    <CrumbContext.Provider value={setObjectLabel}>
      <div className="flex min-h-dvh flex-col bg-surface">
        <a
          href="#inhalt"
          className="no-print sr-only rounded-md bg-surface px-3 py-2 font-sans text-base font-medium text-ink focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:border focus:border-line-strong"
        >
          {de ? "Zum Inhalt springen" : "Skip to content"}
        </a>
        <TopBar className="no-print h-13 px-4 sm:px-8" contentClassName="max-w-[1312px] gap-3" actions={<StorageStatus language={language} />}>
          <nav aria-label={de ? "Pfad" : "Breadcrumb"} className="flex min-w-0 items-center gap-2.5">
            <Link href="/invoices" className="shrink-0 rounded-sm font-sans text-lg font-semibold tracking-snug text-ink outline-none transition-transform duration-150 ease-out active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-ring/50 motion-reduce:active:scale-100">
              Helferlein
            </Link>
            {crumbs.length > 0 && (
              <ol className="flex min-w-0 items-center gap-2.5">
                {crumbs.map((crumb, index) => {
                  const current = index === crumbs.length - 1;
                  const parent = index === crumbs.length - 2;
                  return (
                    <li key={`${crumb.label}-${index}`} className={current ? "flex min-w-0 items-center gap-2.5" : parent ? "flex min-w-0 shrink-[2] items-center gap-2.5" : "hidden min-w-0 shrink items-center gap-2.5 sm:flex"}>
                      <BreadcrumbChevron />
                      {crumb.href && !current
                        ? <BreadcrumbLink asChild className="max-w-60 text-lg/5"><Link href={crumb.href} title={crumb.label}>{crumb.label}</Link></BreadcrumbLink>
                        : <BreadcrumbLink asChild current className="cursor-default text-lg/5 hover:bg-transparent active:scale-100"><span title={crumb.label}>{crumb.label}</span></BreadcrumbLink>}
                    </li>
                  );
                })}
              </ol>
            )}
          </nav>
        </TopBar>
        <SectionNav items={areas} activeKey={area?.key} exactKey={atPage && !subPages ? area?.key : undefined} label={de ? "Hauptnavigation" : "Main navigation"} className="px-4 max-md:hidden sm:px-8" />
        {subPages && <SectionNav sub items={subPages} activeKey={page?.key} exactKey={atPage ? page?.key : undefined} label={de ? "Seiten dieses Bereichs" : "Pages in this area"} className="px-4 max-md:hidden sm:px-8" />}
        <MobileNav key={pathname} areas={areas} area={area} page={page} title={de ? "Navigation" : "Navigation"} closeLabel={de ? "Schließen" : "Close"} />
        <main id="inhalt" tabIndex={-1} className="flex w-full grow flex-col items-center px-4 pt-10 pb-20 outline-none sm:px-8 sm:pt-12">
          <div className="flex w-full max-w-[1312px] flex-col">{children}</div>
        </main>
      </div>
    </CrumbContext.Provider>
  );
}
