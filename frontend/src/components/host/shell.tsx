"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarDays, ChefHat, ClipboardCheck, ClipboardList, FlaskConical, Home, Inbox, LayoutDashboard, LogOut, Menu, MessageSquareText, Phone,
  Radio, Settings, ShieldCheck, Siren, Star, TrendingUp, Users, Wallet, X,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import * as React from "react";

import { useConfig, useLogout, useMe } from "@/components/providers";
import { PhoneLogin } from "@/components/site/phone-login";
import { Button } from "@/components/ui/button";
import { Avatar, Spinner } from "@/components/ui/misc";
import { get, post } from "@/lib/api";
import { ago } from "@/lib/format";
import { cn } from "@/lib/utils";

type AlertRow = { id: number; kind: string; severity: string; status: string; summary: string; phone: string; created_at: string; booking: string | null };

const NAV: { group: string; items: { href: string; label: string; icon: React.ComponentType<{ className?: string }>; badge?: "inbox" | "alerts" }[] }[] = [
  {
    group: "Operate",
    items: [
      { href: "/host", label: "Today", icon: LayoutDashboard },
      { href: "/host/calendar", label: "Calendar", icon: CalendarDays },
      { href: "/host/reservations", label: "Reservations", icon: ClipboardList },
      { href: "/host/inbox", label: "Inbox", icon: Inbox, badge: "inbox" },
      { href: "/host/tasks", label: "Housekeeping & tasks", icon: ClipboardCheck },
      { href: "/host/kitchen", label: "Breakfast & kitchen", icon: ChefHat },
    ],
  },
  {
    group: "Grow",
    items: [
      { href: "/host/listings", label: "Listings", icon: Home },
      { href: "/host/guests", label: "Guests", icon: Users },
      { href: "/host/messaging", label: "Messaging & automations", icon: MessageSquareText },
      { href: "/host/reviews", label: "Reviews", icon: Star },
      { href: "/host/insights", label: "Insights", icon: TrendingUp },
    ],
  },
  {
    group: "Run the business",
    items: [
      { href: "/host/payments", label: "Payments", icon: Wallet },
      { href: "/host/safety", label: "Safety & compliance", icon: ShieldCheck, badge: "alerts" },
      { href: "/host/channels", label: "Africa's Talking", icon: Radio },
      { href: "/host/settings", label: "Settings", icon: Settings },
    ],
  },
];

export function HostShell({ children }: { children: React.ReactNode }) {
  const { data: me, isLoading } = useMe();
  if (isLoading) {
    return (
      <div className="grid min-h-dvh place-items-center">
        <Spinner className="size-7" />
      </div>
    );
  }
  if (!me?.authenticated) return <HostLogin />;
  if (!me.is_host) return <NotHost name={me.name} />;
  return <Shell>{children}</Shell>;
}

function HostLogin() {
  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      <div className="flex items-center justify-center p-8">
        <div className="w-full max-w-sm">
          <Link href="/" className="mb-10 inline-flex items-center gap-2 font-bold">
            <Logo /> Amina Stays <span className="font-normal text-ink-2">· Host</span>
          </Link>
          <PhoneLogin title="Host console" subtitle="Log in with your registered host phone number." cta="Send code" />
        </div>
      </div>
      <div className="relative hidden overflow-hidden bg-ocean-700 lg:block">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="https://images.unsplash.com/photo-1602002418082-a4443e081dd1?auto=format&fit=crop&w=1400&q=80" alt="" className="absolute inset-0 size-full object-cover opacity-60" />
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 p-12 text-white">
          <p className="text-3xl font-bold tracking-tight">Every guest, every channel, one console.</p>
          <p className="mt-3 max-w-md text-white/80">Bookings from the web, USSD, SMS and voice land here — with payments, door codes, breakfast, housekeeping and safety alerts in one place.</p>
        </div>
      </div>
    </div>
  );
}

function NotHost({ name }: { name?: string }) {
  const logout = useLogout();
  return (
    <div className="grid min-h-dvh place-items-center p-8 text-center">
      <div>
        <h1 className="text-2xl font-bold">Hi {name || "there"} — this area is for Amina&apos;s team</h1>
        <p className="mt-2 text-ink-2">Your trips and messages are on the guest site.</p>
        <div className="mt-6 flex justify-center gap-3">
          <Button asChild variant="dark"><Link href="/trips">Go to my trips</Link></Button>
          <Button variant="soft" onClick={logout}>Log out</Button>
        </div>
      </div>
    </div>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("grid size-8 place-items-center rounded-lg bg-brand-500 text-white", className)} aria-hidden>
      <svg viewBox="0 0 24 24" className="size-5" fill="none">
        <path d="M12 4l5 8H7z" fill="currentColor" />
        <path d="M4 16c2.7-1.4 5.3-1.4 8 0s5.3 1.4 8 0" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    </span>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);
  const pathname = usePathname();
  const [menuPath, setMenuPath] = React.useState(pathname);
  if (pathname !== menuPath) {
    // navigating closes the mobile menu
    setMenuPath(pathname);
    setOpen(false);
  }
  return (
    <div className="min-h-dvh bg-surface">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[264px] border-r border-line-soft bg-white lg:block">
        <Sidebar />
      </aside>
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-[280px] bg-white shadow-float animate-slide-up">
            <button className="absolute top-4 right-3 grid size-9 place-items-center rounded-full hover:bg-surface" onClick={() => setOpen(false)} aria-label="Close menu">
              <X className="size-4" />
            </button>
            <Sidebar />
          </aside>
        </div>
      )}
      <div className="lg:pl-[264px]">
        <div className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-line-soft bg-white px-4 lg:hidden">
          <button className="grid size-9 place-items-center rounded-full hover:bg-surface" onClick={() => setOpen(true)} aria-label="Open menu">
            <Menu className="size-5" />
          </button>
          <Logo className="size-7" />
          <span className="font-bold">Host console</span>
        </div>
        <SosBanner />
        <main className="mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-8 sm:py-8">{children}</main>
      </div>
    </div>
  );
}

function Sidebar() {
  const pathname = usePathname();
  const { data: me } = useMe();
  const { data: config } = useConfig();
  const logout = useLogout();
  const { data: inbox } = useQuery({
    queryKey: ["host", "inbox-count"],
    queryFn: () => get<unknown[]>("/api/host/inbox?filter=needs_reply"),
    refetchInterval: 15_000,
  });
  const { data: alerts } = useQuery({
    queryKey: ["host", "alerts", "active"],
    queryFn: () => get<AlertRow[]>("/api/host/alerts?status=active"),
    refetchInterval: 10_000,
  });
  const badges = { inbox: inbox?.length ?? 0, alerts: alerts?.filter((a) => a.status === "open").length ?? 0 };

  return (
    <div className="flex h-full flex-col">
      <Link href="/host" className="flex h-16 shrink-0 items-center gap-2.5 px-5">
        <Logo />
        <span className="leading-tight">
          <span className="block text-[15px] font-bold">Amina Stays</span>
          <span className="block text-xs text-ink-2">Host console</span>
        </span>
      </Link>
      <nav className="no-scrollbar flex-1 overflow-y-auto px-3 pb-4">
        {NAV.map((g) => (
          <div key={g.group} className="mt-4 first:mt-1">
            <p className="px-3 pb-1.5 text-[11px] font-bold tracking-wider text-ink-3 uppercase">{g.group}</p>
            {g.items.map((item) => {
              const active = item.href === "/host" ? pathname === "/host" : pathname.startsWith(item.href);
              const count = item.badge ? badges[item.badge] : 0;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex items-center gap-3 rounded-lg px-3 py-2 text-[14px] font-medium text-ink-2 transition-colors hover:bg-surface hover:text-ink",
                    active && "bg-surface font-semibold text-ink",
                  )}
                >
                  <item.icon className="size-[18px]" />
                  <span className="flex-1 truncate">{item.label}</span>
                  {count > 0 && (
                    <span className={cn("min-w-5 rounded-full px-1.5 text-center text-[11px] leading-5 font-bold text-white", item.badge === "alerts" ? "bg-danger" : "bg-brand-500")}>
                      {count}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        ))}
        {config?.demo && (
          <Link href="/demo" className="mt-4 flex items-center gap-3 rounded-lg border border-dashed border-ocean-500/40 bg-ocean-50 px-3 py-2 text-[14px] font-semibold text-ocean-700">
            <FlaskConical className="size-[18px]" /> Demo Lab · phones
          </Link>
        )}
      </nav>
      <div className="border-t border-line-soft p-3">
        <div className="flex items-center gap-3 rounded-lg px-2 py-2">
          <Avatar name={me?.name} size={34} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{me?.name || me?.phone}</p>
            <p className="truncate text-xs text-ink-2 capitalize">{me?.role}</p>
          </div>
          <button onClick={logout} className="grid size-8 place-items-center rounded-full text-ink-2 hover:bg-surface hover:text-ink" aria-label="Log out">
            <LogOut className="size-4" />
          </button>
        </div>
        <Link href="/" className="mt-1 block rounded-lg px-2 py-1.5 text-center text-[13px] font-semibold text-ink-2 hover:text-ink">
          View guest website →
        </Link>
      </div>
    </div>
  );
}

function SosBanner() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["host", "alerts", "active"],
    queryFn: () => get<AlertRow[]>("/api/host/alerts?status=active"),
    refetchInterval: 10_000,
  });
  const sos = data?.filter((a) => a.kind === "sos" && a.status === "open") ?? [];
  if (!sos.length) return null;
  const a = sos[0];
  return (
    <div className="sticky top-0 z-30 border-b border-danger/30 bg-danger text-white lg:top-0">
      <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-3 px-4 py-3 sm:px-8">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-white/20 animate-pulse-ring">
          <Siren className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-bold">Guest needs urgent help{sos.length > 1 ? ` (+${sos.length - 1} more)` : ""}</p>
          <p className="truncate text-sm text-white/85">{a.summary} · {ago(a.created_at)}</p>
        </div>
        <Button asChild size="sm" className="bg-white text-danger hover:bg-white/90">
          <a href={`tel:${a.phone}`}><Phone className="size-4" /> Call guest</a>
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="border-white/60 bg-transparent text-white hover:bg-white/10"
          onClick={async () => {
            await post(`/api/host/alerts/${a.id}/ack`);
            qc.invalidateQueries({ queryKey: ["host"] });
          }}
        >
          I&apos;m handling it
        </Button>
      </div>
    </div>
  );
}
