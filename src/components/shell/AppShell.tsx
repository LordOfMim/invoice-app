"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { BreadcrumbChevron, BreadcrumbLink } from "@/components/platform/breadcrumb";
import { HugeiconsIcon } from "@/components/platform/icon";
import { cn } from "@/components/platform/lib/cn";
import { TopBar } from "@/components/platform/top-bar";
import { SessionNotices } from "@/components/SessionNotices";
import { StorageStatus } from "@/components/StorageStatus";
import { getMailState, getServerMailState, lastMailAttempt, loadMail, subscribeMail, syncMail, unreadCount } from "@/lib/mail";
import { runSessionTasks } from "@/lib/sessionTasks";
import { getCurrentData } from "@/lib/storage/store";
import { usePersistedSettings } from "@/lib/storage/useStore";
import { HelferleinLogoLink } from "./HelferleinLogo";
import { locate, navGroups, type NavGroup, type NavItem } from "./nav";
import { MobileNav } from "./MobileNav";

/*
 * Helferlein frame (docs/design-reference.md, „Navigations- und Seitenkonzept“): a left sidebar with the grouped
 * navigation from lg upwards, next to it the sticky 48px TopBar (path, save status) and the page. The sidebar uses
 * the page-list recipe of Platform `line-shell-frame.tsx` (16px Hugeicons glyph + word label, active row on
 * surface-pressed, medium ink) at the readability size, on the rail surface with a hairline. It is as tall as the
 * window and scrolls by itself, so every entry stays reachable on short windows. Below lg the sidebar gives way to
 * the labelled menu row with a sheet (MobileNav). The user's own Helferlein logo heads the sidebar (TopBar below lg);
 * no Platform emblem, account menu or environment badge.
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

const MAIL_FETCH_INTERVAL_MS = 5 * 60 * 1000;

function SidebarLink({ item, current, exact, badge }: { item: NavItem; current: boolean; exact: boolean; badge?: { count: number; label: string } }) {
  return (
    <Link
      href={item.href}
      title={item.hint}
      // Detail pages keep their list entry marked: „page“ on the list itself, „true“ below it.
      aria-current={current ? (exact ? "page" : "true") : undefined}
      className={cn(
        "flex min-h-9 items-center gap-2 rounded-md px-2 py-1.5 font-sans text-lg outline-none transition-colors duration-100 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset",
        current ? "bg-surface-pressed font-medium text-ink" : "font-medium text-ink-secondary hover:bg-surface-selected hover:text-ink",
      )}
    >
      <HugeiconsIcon icon={item.icon} size={16} className={cn("shrink-0", current ? "text-ink" : "text-ink-soft")} />
      <span className="min-w-0 hyphens-auto break-words">{item.label}</span>
      {badge && badge.count > 0 && (
        <span className="ml-auto shrink-0 rounded-pill bg-fill px-1.5 py-0.5 font-sans text-sm/4 font-medium tabular-nums text-surface">
          <span aria-hidden>{badge.count > 99 ? "99+" : badge.count}</span>
          <span className="sr-only">, {badge.label}</span>
        </span>
      )}
    </Link>
  );
}

function Sidebar({ groups, active, pathname, label, badges }: { groups: readonly NavGroup[]; active?: NavItem; pathname: string; label: string; badges: Record<string, { count: number; label: string }> }) {
  return (
    <aside className="no-print sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-line bg-surface-rail lg:flex">
      <div className="flex h-12 shrink-0 items-center px-4">
        <HelferleinLogoLink />
      </div>
      <nav aria-label={label} className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-2 pt-1 pb-4">
        {groups.map((group) => (
          <div key={group.key} className="flex flex-col gap-0.5">
            {group.label && <p id={`sidebar-group-${group.key}`} className="px-2 pb-1 font-sans text-sm font-medium text-ink-muted">{group.label}</p>}
            <ul aria-labelledby={group.label ? `sidebar-group-${group.key}` : undefined} className="flex flex-col gap-0.5">
              {group.items.map((item) => (
                <li key={item.key}>
                  <SidebarLink item={item} current={active?.key === item.key} exact={pathname === item.href} badge={badges[item.key]} />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
    </aside>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { adapter, settings } = usePersistedSettings();
  const language = settings?.language ?? "de";
  const uiScale = settings?.uiScale ?? "normal";
  const loaded = settings !== null;

  // Text size of the app chrome; documents keep their own sizes (globals.css).
  useEffect(() => {
    const root = document.documentElement;
    if (!loaded) return; // until the settings are read, the copy applied by the layout script stands
    if (uiScale === "normal") delete root.dataset.uiScale;
    else root.dataset.uiScale = uiScale;
    try { localStorage.setItem("helferlein:ui-scale", uiScale); } catch { /* only avoids a flash on the next load */ }
  }, [uiScale, loaded]);

  // Recurring invoices and the weekly backup, once the data is there.
  useEffect(() => {
    if (!adapter || !loaded) return;
    const data = getCurrentData();
    if (!data) return;
    void runSessionTasks(adapter, data.settings, data.invoices.length > 0 || (data.quotes?.length ?? 0) > 0);
  }, [adapter, loaded]);
  // The mailbox is fetched at the start, every few minutes and when the window comes back to the front. A login the
  // provider refused is not repeated by itself (that can lock the account): fetching resumes once the account was
  // saved again or a fetch the user started by hand got through.
  const mail = useSyncExternalStore(subscribeMail, getMailState, getServerMailState);
  const mailConfigured = mail.configured && !mail.needsPassword && !mail.authFailed;
  useEffect(() => { void loadMail(); }, []);
  useEffect(() => {
    if (!mailConfigured) return;
    // Measured from the last attempt, not the last success: a server that is down is not asked on every focus.
    const due = () => Date.now() - lastMailAttempt() > MAIL_FETCH_INTERVAL_MS;
    if (due()) void syncMail();
    const timer = window.setInterval(() => { if (!document.hidden) void syncMail(); }, MAIL_FETCH_INTERVAL_MS);
    const onVisible = () => { if (!document.hidden && due()) void syncMail(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); window.removeEventListener("focus", onVisible); };
  }, [mailConfigured]);
  const unreadMail = unreadCount(mail);
  const badges = useMemo(() => ({ mail: { count: unreadMail, label: unreadMail === 1 ? "1 ungelesene E-Mail" : `${unreadMail} ungelesene E-Mails` } }), [unreadMail]);

  const pathname = usePathname() ?? "";
  const [objectLabel, setObjectLabel] = useState<string | null>(null);
  const groups = useMemo(() => navGroups(language), [language]);
  const { group, item } = locate(groups, pathname);
  const atItem = item ? pathname === item.href : false;

  const crumbs: { label: string; href?: string }[] = [];
  if (item) crumbs.push({ label: item.label, href: item.href });
  if (objectLabel && !atItem) crumbs.push({ label: objectLabel });

  const de = language === "de";
  return (
    <CrumbContext.Provider value={setObjectLabel}>
      <div className="app-frame flex min-h-dvh bg-surface">
        <a
          href="#inhalt"
          className="no-print sr-only rounded-md bg-surface px-3 py-2 font-sans text-base font-medium text-ink focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:shadow-high"
        >
          {de ? "Zum Inhalt springen" : "Skip to content"}
        </a>
        <Sidebar groups={groups} active={item} pathname={pathname} label={de ? "Hauptnavigation" : "Main navigation"} badges={badges} />
        <div className="app-main-column flex min-w-0 flex-1 flex-col">
          <TopBar className="no-print h-12 px-4" contentClassName="max-w-[1600px] gap-3" actions={<StorageStatus language={language} />}>
            <nav aria-label={de ? "Pfad" : "Breadcrumb"} className="flex min-w-0 items-center gap-2.5">
              {/* The logo lives in the sidebar from lg upwards. */}
              <HelferleinLogoLink className="lg:hidden" />
              {crumbs.length > 0 && (
                <ol className="flex min-w-0 items-center gap-2.5">
                  {crumbs.map((crumb, index) => {
                    const current = index === crumbs.length - 1;
                    return (
                      <li key={`${crumb.label}-${index}`} className={cn("flex min-w-0 items-center gap-2.5", !current && "shrink-[2] max-sm:hidden")}>
                        <BreadcrumbChevron className={index === 0 ? "lg:hidden" : undefined} />
                        {crumb.href && !current
                          ? <BreadcrumbLink asChild className="max-w-60 text-lg"><Link href={crumb.href} title={crumb.label}>{crumb.label}</Link></BreadcrumbLink>
                          : <BreadcrumbLink asChild current className="cursor-default text-lg hover:bg-transparent active:scale-100"><span title={crumb.label}>{crumb.label}</span></BreadcrumbLink>}
                      </li>
                    );
                  })}
                </ol>
              )}
            </nav>
          </TopBar>
          <MobileNav key={pathname} badges={badges} groups={groups} group={group} item={item} title={de ? "Navigation" : "Navigation"} closeLabel={de ? "Schließen" : "Close"} openLabel={de ? "Navigation öffnen" : "Open navigation"} currentLabel={de ? "aktuell" : "current"} menuLabel={de ? "Menü" : "Menu"} />
          <main id="inhalt" tabIndex={-1} className="app-main flex w-full grow flex-col items-center px-4 pt-6 pb-20 outline-none sm:px-6">
            <div className="app-page-wrapper flex w-full max-w-[1600px] flex-col"><SessionNotices />{children}</div>
          </main>
        </div>
      </div>
    </CrumbContext.Provider>
  );
}
