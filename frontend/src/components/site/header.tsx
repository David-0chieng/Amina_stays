"use client";

import { CircleUser, Heart, Menu, MessageCircle, Search, Smartphone } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import * as React from "react";

import { Logo } from "@/components/host/shell";
import { useAuthDialog, useConfig, useLogout, useMe } from "@/components/providers";
import { PhoneLogin } from "@/components/site/phone-login";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Dropdown, DropdownContent, DropdownItem, DropdownSeparator, DropdownTrigger } from "@/components/ui/overlays";
import { Avatar } from "@/components/ui/misc";
import { cn } from "@/lib/utils";

export function SiteHeader({ children }: { children?: React.ReactNode }) {
  const pathname = usePathname();
  const isHome = pathname === "/";
  const [scrolled, setScrolled] = React.useState(false);
  React.useEffect(() => {
    const on = () => setScrolled(window.scrollY > 8);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  return (
    <header className={cn("sticky top-0 z-40 border-b bg-white transition-shadow", scrolled ? "border-line-soft shadow-soft" : "border-transparent", !isHome && "border-line-soft")}>
      <div className={cn(isHome ? "container-site" : "container-narrow max-w-[1280px]")}>
        <div className="flex h-[76px] items-center justify-between gap-4">
          <Link href="/" className="flex shrink-0 items-center gap-2.5" aria-label="Amina Stays home">
            <Logo className="size-9 rounded-xl" />
            <span className="hidden text-[19px] font-extrabold tracking-tight text-brand-600 sm:inline">amina stays</span>
          </Link>
          {!isHome && (
            <Link
              href="/#stays"
              className="hidden items-center gap-3 rounded-full border border-line-soft py-2 pr-2 pl-5 text-sm font-semibold shadow-pill transition-shadow hover:shadow-card md:flex"
            >
              <span>Anywhere on the coast</span>
              <span className="h-5 w-px bg-line" />
              <span className="font-medium text-ink-2">Any week</span>
              <span className="grid size-8 place-items-center rounded-full bg-brand-500 text-white">
                <Search className="size-3.5" strokeWidth={3} />
              </span>
            </Link>
          )}
          <UserMenu />
        </div>
        {children}
      </div>
    </header>
  );
}

function UserMenu() {
  const { data: me } = useMe();
  const { data: config } = useConfig();
  const { requireLogin } = useAuthDialog();
  const logout = useLogout();
  const router = useRouter();
  const ways = config?.channels.ussd_code || config?.channels.sms_number;
  return (
    <div className="flex items-center gap-1">
      {me?.is_host ? (
        <Link href="/host" className="hidden rounded-full px-4 py-2.5 text-sm font-semibold hover:bg-surface lg:block">
          Host console
        </Link>
      ) : (
        <Link href="/help#book-your-way" className="hidden items-center gap-2 rounded-full px-4 py-2.5 text-sm font-semibold hover:bg-surface lg:flex">
          <Smartphone className="size-4" /> {ways ? `Book by SMS or ${config?.channels.ussd_code ? "USSD" : "phone"}` : "Book without data"}
        </Link>
      )}
      <Dropdown>
        <DropdownTrigger
          className="flex items-center gap-3 rounded-full border border-line-soft py-1.5 pr-1.5 pl-3.5 transition-shadow hover:shadow-card data-[state=open]:shadow-card"
          aria-label="Account menu"
        >
          <Menu className="size-4" strokeWidth={2.4} />
          {me?.authenticated ? <Avatar name={me.name || me.phone} size={30} /> : <CircleUser className="size-[30px] text-ink-2" strokeWidth={1.4} />}
        </DropdownTrigger>
        <DropdownContent className="w-60">
          {me?.authenticated ? (
            <>
              <div className="px-4 py-2">
                <p className="truncate text-sm font-semibold">{me.name || "Welcome"}</p>
                <p className="truncate text-xs text-ink-2">{me.phone}</p>
              </div>
              <DropdownSeparator />
              <DropdownItem onSelect={() => router.push("/messages")} className="font-semibold">Messages</DropdownItem>
              <DropdownItem onSelect={() => router.push("/trips")} className="font-semibold">Trips</DropdownItem>
              <DropdownItem onSelect={() => router.push("/wishlists")} className="font-semibold">Wishlists</DropdownItem>
              <DropdownSeparator />
              <DropdownItem onSelect={() => router.push("/account")}>Account &amp; privacy</DropdownItem>
              {me.is_host && <DropdownItem onSelect={() => router.push("/host")}>Host console</DropdownItem>}
              <DropdownItem onSelect={() => router.push("/help")}>Help centre</DropdownItem>
              <DropdownSeparator />
              <DropdownItem onSelect={logout}>Log out</DropdownItem>
            </>
          ) : (
            <>
              <DropdownItem onSelect={() => requireLogin()} className="font-semibold">Log in or sign up</DropdownItem>
              <DropdownSeparator />
              <DropdownItem onSelect={() => router.push("/help#book-your-way")}>Book by SMS, USSD or phone</DropdownItem>
              <DropdownItem onSelect={() => router.push("/help")}>Help centre</DropdownItem>
              <DropdownItem onSelect={() => router.push("/host")}>Host console</DropdownItem>
            </>
          )}
        </DropdownContent>
      </Dropdown>
    </div>
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

export function MobileTabBar() {
  const pathname = usePathname();
  const { data: me } = useMe();
  const { requireLogin } = useAuthDialog();
  const show = ["/", "/trips", "/wishlists", "/messages", "/account", "/help"].includes(pathname);
  if (!show) return null;
  const tabs = [
    { href: "/", label: "Explore", icon: Search },
    { href: "/wishlists", label: "Wishlists", icon: Heart, auth: true },
    { href: "/trips", label: "Trips", icon: Logo as unknown as React.ComponentType<{ className?: string }>, auth: true },
    { href: "/messages", label: "Messages", icon: MessageCircle, auth: true },
    { href: "/account", label: me?.authenticated ? "Profile" : "Log in", icon: CircleUser, auth: true },
  ];
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-line-soft bg-white pb-[env(safe-area-inset-bottom)] md:hidden">
      <div className="grid grid-cols-5">
        {tabs.map((t) => {
          const active = t.href === "/" ? pathname === "/" : pathname.startsWith(t.href);
          const Icon = t.icon;
          return (
            <Link
              key={t.href}
              href={t.href}
              onClick={(e) => {
                if (t.auth && !me?.authenticated) {
                  e.preventDefault();
                  requireLogin();
                }
              }}
              className={cn("flex flex-col items-center gap-1 py-2.5 text-[10px] font-semibold", active ? "text-brand-600" : "text-ink-2")}
            >
              {t.label === "Trips" ? (
                <Logo className={cn("size-6 rounded-md", !active && "bg-ink-3")} />
              ) : (
                <Icon className="size-6" />
              )}
              {t.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
