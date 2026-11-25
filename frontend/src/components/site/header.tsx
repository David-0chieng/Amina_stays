"use client";

import { CircleHelp, CircleUserRound, Heart, LogOut, Menu, MessageSquare, Search, Settings, UserRound } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import * as React from "react";

import { useAuthDialog, useConfig, useLogout, useMe } from "@/components/providers";
import { BrandLink, BrandMark } from "@/components/site/brand";
import { PhoneLogin } from "@/components/site/phone-login";
import { CompactSearch, MobileSearch, SearchBar, type Segment } from "@/components/site/search-bar";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Icon3D, type Icon3DName } from "@/components/ui/icon3d";
import { Avatar } from "@/components/ui/misc";
import { Dropdown, DropdownContent, DropdownItem, DropdownSeparator, DropdownTrigger } from "@/components/ui/overlays";
import { cn } from "@/lib/utils";

export type SiteTab = "homes" | "experiences" | "services";

export const SITE_TABS: { id: SiteTab; href: string; label: string; icon: Icon3DName }[] = [
  { id: "homes", href: "/", label: "Homes", icon: "homes" },
  { id: "experiences", href: "/experiences", label: "Experiences", icon: "sailboat" },
  { id: "services", href: "/services", label: "Services", icon: "services" },
];

// Desktop heights: an 80px top row, plus a 116px search row while the home header is expanded.
const ROW = 80;
const EXPANDED = 196;

/**
 * The site header, modelled on Airbnb's 2025 header.
 * - mode "home": a tall header (tabs + full search bar on a soft band) that collapses into the
 *   compact search pill once you scroll; it's fixed with a spacer, so collapsing never shifts content.
 * - mode "compact": the pill only (inner pages). Clicking it expands the full search over the page.
 * - mode "minimal": just the logo (checkout), so nothing competes with finishing the booking.
 * On phones the header is just the "Start your search" pill (when `mobileSearch`), as on Airbnb.
 */
export function SiteHeader({
  mode = "compact", tab = "homes", width = "site", mobileSearch = false, children,
}: {
  mode?: "home" | "compact" | "minimal";
  tab?: SiteTab;
  width?: "site" | "narrow";
  mobileSearch?: boolean;
  children?: React.ReactNode;
}) {
  const isHome = mode === "home";
  const [atTop, setAtTop] = React.useState(true);
  const [overlay, setOverlay] = React.useState<Segment | null>(null);
  const [overlayKey, setOverlayKey] = React.useState(0);

  React.useEffect(() => {
    const on = () => {
      if (isHome) setAtTop(window.scrollY < EXPANDED - ROW);
      setOverlay(null);
    };
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, [isHome]);

  const openOverlay = (seg: Segment) => {
    setOverlayKey((k) => k + 1);
    setOverlay(seg);
  };
  const tall = isHome && atTop;
  const container = width === "narrow" ? "container-narrow" : "container-site";

  if (mode === "minimal") {
    return (
      <header className="z-40 border-b border-line-soft bg-white max-md:hidden">
        <div className={cn(container, "flex h-20 items-center")}>
          <BrandLink />
        </div>
      </header>
    );
  }

  const topRow = (expanded: boolean) => (
    <div className={cn(container, "grid h-20 grid-cols-[1fr_auto_1fr] items-center gap-4")}>
      <BrandLink compact />
      <div className="flex justify-center">
        {expanded ? (
          <Tabs active={tab} />
        ) : (
          <React.Suspense fallback={<div className="h-12 w-[380px] rounded-full border border-line-soft shadow-pill" />}>
            <CompactSearch onOpen={openOverlay} />
          </React.Suspense>
        )}
      </div>
      <UserMenu />
    </div>
  );
  const searchRow = (initial: Segment | null) => (
    <div className={cn(container, "pt-3.5 pb-9")}>
      <React.Suspense fallback={<div className="mx-auto h-[66px] max-w-[850px] rounded-full border border-line bg-white shadow-search" />}>
        <SearchBar key={overlayKey} initial={initial} onClose={() => setOverlay(null)} />
      </React.Suspense>
    </div>
  );

  return (
    <>
      <header
        className={cn(
          "z-40 bg-white",
          isHome ? "sticky top-0 md:fixed md:inset-x-0" : "sticky top-0",
          !mobileSearch && "max-md:hidden",
        )}
      >
        {/* phones */}
        {mobileSearch && (
          <div className="bg-white px-6 pt-3 pb-3 md:hidden">
            <React.Suspense fallback={<div className="h-14 rounded-full border border-line-soft shadow-pill" />}>
              <MobileSearch />
            </React.Suspense>
          </div>
        )}
        {/* desktop & tablet */}
        <div className={cn("relative hidden border-b border-line-soft md:block", tall ? "hero-band" : "bg-white")}>
          {topRow(tall)}
          {tall && searchRow(null)}
          {overlay !== null && !tall && (
            <div className="hero-band absolute inset-x-0 top-0 z-10 border-b border-line-soft animate-fade-in">
              {topRow(true)}
              {searchRow(overlay)}
            </div>
          )}
        </div>
        {children}
      </header>
      {isHome && <div aria-hidden className="hidden md:block" style={{ height: EXPANDED }} />}
      {overlay !== null && !tall && <div className="fixed inset-0 z-30 bg-black/25 animate-fade-in max-md:hidden" onClick={() => setOverlay(null)} />}
    </>
  );
}

function Tabs({ active }: { active: SiteTab }) {
  return (
    <nav className="flex items-center gap-2 lg:gap-4" aria-label="Browse">
      {SITE_TABS.map((t) => {
        const on = t.id === active;
        return (
          <Link
            key={t.id}
            href={t.href}
            aria-current={on ? "page" : undefined}
            className={cn("group relative flex h-14 items-center gap-1.5 px-2.5 text-sm font-medium transition-colors", on ? "text-ink" : "text-ink-2 hover:text-ink")}
          >
            <Icon3D name={t.icon} size={44} eager className="transition-transform duration-300 group-hover:scale-110 group-hover:-rotate-3" />
            {t.label}
            <span className={cn("absolute inset-x-2.5 -bottom-1 h-[3px] rounded-full bg-ink transition-opacity", on ? "opacity-100" : "opacity-0 group-hover:opacity-20")} />
          </Link>
        );
      })}
    </nav>
  );
}

/** Mobile tab chips (Homes · Experiences · Services) shown under the search pill. */
export function MobileTabs({ active, className }: { active: SiteTab; className?: string }) {
  return (
    <nav className={cn("no-scrollbar flex gap-2 overflow-x-auto border-b border-line-soft px-6 pt-1 pb-3 md:hidden", className)} aria-label="Browse">
      {SITE_TABS.map((t) => (
        <Link
          key={t.id}
          href={t.href}
          aria-current={t.id === active ? "page" : undefined}
          className={cn(
            "flex h-11 shrink-0 items-center gap-1.5 rounded-full pr-4 pl-2 text-sm font-medium shadow-[0_2px_6px_rgb(0_0_0/0.08)] transition-colors",
            t.id === active ? "border border-line bg-chip text-ink" : "border border-line-soft bg-white text-ink-2",
          )}
        >
          <Icon3D name={t.icon} size={30} eager />
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

function UserMenu() {
  const { data: me } = useMe();
  const { data: config } = useConfig();
  const { requireLogin } = useAuthDialog();
  const logout = useLogout();
  const router = useRouter();
  const c = config?.channels;
  return (
    <div className="flex items-center justify-end gap-2">
      {me?.is_host ? (
        <Link href="/host" className="hidden h-10 items-center rounded-full px-4 text-sm font-medium whitespace-nowrap transition-colors hover:bg-chip lg:flex">
          Switch to hosting
        </Link>
      ) : (
        <Link href="/help#book-your-way" className="hidden h-10 items-center rounded-full px-4 text-sm font-medium whitespace-nowrap transition-colors hover:bg-chip lg:flex">
          Book without data
        </Link>
      )}
      <button
        type="button"
        onClick={() => (me?.authenticated ? router.push("/account") : requireLogin())}
        aria-label={me?.authenticated ? "Your profile" : "Log in"}
        className="grid size-10 place-items-center rounded-full bg-chip transition-colors hover:bg-line-soft"
      >
        {me?.authenticated ? <Avatar name={me.name || me.phone} size={32} className="bg-ink! text-[13px]!" /> : <CircleUserRound className="size-5" strokeWidth={1.8} />}
      </button>
      <Dropdown>
        <DropdownTrigger className="grid size-10 place-items-center rounded-full bg-chip transition-colors outline-none hover:bg-line-soft data-[state=open]:bg-line-soft" aria-label="Main menu">
          <Menu className="size-[18px]" strokeWidth={2.2} />
        </DropdownTrigger>
        <DropdownContent className="w-[260px] rounded-2xl border-0 py-2 shadow-pop">
          {me?.authenticated ? (
            <>
              <MenuItem onSelect={() => router.push("/wishlists")} icon={Heart}>Wishlists</MenuItem>
              <MenuItem onSelect={() => router.push("/trips")} icon={BrandMark}>Trips</MenuItem>
              <MenuItem onSelect={() => router.push("/messages")} icon={MessageSquare}>Messages</MenuItem>
              <MenuItem onSelect={() => router.push("/account")} icon={UserRound}>Profile</MenuItem>
              <DropdownSeparator />
              <MenuItem onSelect={() => router.push("/account")} icon={Settings}>Account &amp; privacy</MenuItem>
              <MenuItem onSelect={() => router.push("/help")} icon={CircleHelp}>Help Centre</MenuItem>
              <DropdownSeparator />
              {me.is_host ? (
                <PromoItem onSelect={() => router.push("/host")} icon="key" title="Switch to hosting" text="Today, calendar, inbox and the team." />
              ) : (
                <PromoItem onSelect={() => router.push("/help#book-your-way")} icon="mobile-phone" title="Book without data" text={c?.ussd_code ? `Dial ${c.ussd_code} or text Amina — English or Kiswahili.` : "Book by USSD, SMS or a phone call."} />
              )}
              <DropdownSeparator />
              <MenuItem onSelect={logout} icon={LogOut}>Log out</MenuItem>
            </>
          ) : (
            <>
              <MenuItem onSelect={() => router.push("/help")} icon={CircleHelp}>Help Centre</MenuItem>
              <DropdownSeparator />
              <PromoItem onSelect={() => router.push("/help#book-your-way")} icon="mobile-phone" title="Book without data" text={c?.ussd_code ? `Dial ${c.ussd_code} or text Amina — English or Kiswahili.` : "Book by USSD, SMS or a phone call."} />
              <DropdownSeparator />
              <MenuItem onSelect={() => router.push("/host")}>Host console</MenuItem>
              <MenuItem onSelect={() => router.push("/demo")}>Demo Lab</MenuItem>
              <DropdownSeparator />
              <MenuItem onSelect={() => requireLogin()} className="font-medium">Log in or sign up</MenuItem>
            </>
          )}
        </DropdownContent>
      </Dropdown>
    </div>
  );
}

function MenuItem({ icon: Icon, children, onSelect, className }: {
  icon?: React.ComponentType<{ className?: string; strokeWidth?: number }>; children: React.ReactNode; onSelect: () => void; className?: string;
}) {
  return (
    <DropdownItem onSelect={onSelect} className={cn("gap-3 px-5 py-3 text-sm", className)}>
      {Icon && <Icon className="size-[18px] shrink-0" strokeWidth={1.8} />}
      {children}
    </DropdownItem>
  );
}

function PromoItem({ icon, title, text, onSelect }: { icon: Icon3DName; title: string; text: string; onSelect: () => void }) {
  return (
    <DropdownItem onSelect={onSelect} className="items-start gap-3 px-5 py-3">
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{title}</span>
        <span className="mt-0.5 block text-xs leading-snug text-ink-2">{text}</span>
      </span>
      <Icon3D name={icon} size={44} />
    </DropdownItem>
  );
}

export function LoginDialog() {
  const { dialog, closeLogin } = useAuthDialog();
  return (
    <Dialog open={dialog.open} onOpenChange={(o) => !o && closeLogin()}>
      <DialogContent title="Log in or sign up" size="sm">
        <div className="p-6">
          <PhoneLogin
            title="Karibu to Amina Stays"
            subtitle={dialog.reason ?? "Your phone number is your account — on the web, USSD, SMS and voice."}
            onDone={() => {
              const then = dialog.then;
              closeLogin();
              then?.();
            }}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

const TAB_BAR_PAGES = ["/", "/s", "/experiences", "/services", "/trips", "/wishlists", "/messages", "/account", "/help"];

/** Phone bottom navigation; slides away while scrolling down, returns on scroll up. */
export function MobileTabBar() {
  const pathname = usePathname();
  const { data: me } = useMe();
  const { requireLogin } = useAuthDialog();
  const [hidden, setHidden] = React.useState(false);
  React.useEffect(() => {
    let last = window.scrollY;
    const on = () => {
      const y = window.scrollY;
      if (Math.abs(y - last) > 6) setHidden(y > last && y > 120);
      last = y;
    };
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  if (!TAB_BAR_PAGES.includes(pathname)) return null;
  const authed = !!me?.authenticated;
  const tabs: { href: string; label: string; icon: React.ComponentType<{ className?: string; strokeWidth?: number }>; auth?: boolean; match?: string[] }[] = [
    { href: "/", label: "Explore", icon: Search, match: ["/", "/s", "/experiences", "/services"] },
    { href: "/wishlists", label: "Wishlists", icon: Heart, auth: true },
    ...(authed
      ? [
          { href: "/trips", label: "Trips", icon: BrandMark },
          { href: "/messages", label: "Messages", icon: MessageSquare },
          { href: "/account", label: "Profile", icon: CircleUserRound },
        ]
      : [{ href: "/account", label: "Log in", icon: CircleUserRound, auth: true }]),
  ];
  return (
    <nav
      className={cn(
        "fixed inset-x-0 bottom-0 z-40 border-t border-line-soft bg-white pb-[env(safe-area-inset-bottom)] transition-transform duration-300 md:hidden",
        hidden && "translate-y-full",
      )}
    >
      <div className="mx-auto flex max-w-md justify-around">
        {tabs.map((t) => {
          const active = t.match ? t.match.includes(pathname) : pathname.startsWith(t.href);
          const Icon = t.icon;
          return (
            <Link
              key={t.label}
              href={t.href}
              onClick={(e) => {
                if (t.auth && !authed) {
                  e.preventDefault();
                  requireLogin();
                }
              }}
              className={cn("flex min-w-16 flex-col items-center gap-1 pt-2.5 pb-2 text-[10px] font-medium", active ? "text-brand-500" : "text-ink-2")}
            >
              <Icon className={cn("size-6", !active && t.icon === BrandMark && "text-ink-3")} strokeWidth={active ? 2.2 : 1.6} />
              <span className={active ? "text-ink" : undefined}>{t.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
