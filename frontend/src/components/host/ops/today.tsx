"use client";

import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight, ArrowUpRight, BedDouble, Bot, CalendarDays, CalendarRange, ChefHat, CircleCheck, ClipboardCheck, Globe, Hourglass, KeyRound,
  LogIn, LogOut, MessageSquare, Siren, Sparkles, Star, Timer, TrendingUp, Wallet,
} from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { ChannelBadge, ErrorBlock, KpiCard, PageHeader, Section, StatusBadge } from "@/components/host/common";
import { useConfig, useMe } from "@/components/providers";
import { Button } from "@/components/ui/button";
import { Badge, Skeleton } from "@/components/ui/misc";
import { Tooltip } from "@/components/ui/overlays";
import { get, post } from "@/lib/api";
import { fmtDate, fmtLong, fmtRange, kes, plural, relDay } from "@/lib/format";
import { cn } from "@/lib/utils";

import {
  BalanceChip, ChannelIcon, ConfirmAction, Countdown, CountPill, GuestAvatar, GuestLine, MiniEmpty, PriorityChip, RelTime, TaskTypeIcon,
} from "./bits";
import { displayName, dueText, duration, greeting, kenyaHour, minutesSince, shortStyle, useHostAction, useNow } from "./lib";
import { DoorLocksPanel } from "./locks";
import { LiveFeed } from "./live-feed";
import { NewReservationButton } from "./new-reservation";
import type { AlertItem, BreakfastRow, Kpis, PendingRequest, ReservationRow, TaskItem, ThreadRow, TodayData } from "./types";

export function TodayView() {
  const today = useQuery({
    queryKey: ["host", "ops", "today"],
    queryFn: () => get<TodayData>("/api/host/today"),
    refetchInterval: 15_000,
  });
  const requests = useQuery({
    queryKey: ["host", "ops", "requests"],
    queryFn: () => get<PendingRequest[]>("/api/host/requests"),
    refetchInterval: 5_000,
  });
  const now = useNow(60_000);
  const { data: config } = useConfig();
  const { data: me } = useMe();
  const hostName = config?.business.host_name || me?.name?.split(" ")[0] || "Amina";
  const d = today.data;

  return (
    <div>
      <PageHeader
        title={now ? `${greeting(kenyaHour(now))}, ${hostName}` : `Karibu, ${hostName}`}
        subtitle={
          d ? (
            <>
              {fmtLong(d.date)} · {d.arrivals.length} arriving · {d.departures.length} leaving · {d.in_house.length} staying
            </>
          ) : (
            <span className="inline-block h-4 w-72 animate-pulse rounded bg-line-soft align-middle" />
          )
        }
        actions={
          <>
            <Button asChild variant="soft">
              <Link href="/host/calendar">
                <CalendarDays className="size-4" /> Open calendar
              </Link>
            </Button>
            <NewReservationButton />
          </>
        }
      />

      {today.error && !d ? (
        <ErrorBlock error={today.error} retry={() => today.refetch()} />
      ) : !d ? (
        <TodaySkeleton />
      ) : (
        <div className="space-y-6">
          <KpiRow week={d.kpis.week} month={d.kpis.month} />

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
            <div className="min-w-0 space-y-6 xl:col-span-2">
              <AttentionCard data={d} requests={requests.data ?? []} />
              <MovementsCard data={d} />
            </div>
            <div className="relative h-[560px] xl:h-auto xl:min-h-[600px]">
              <LiveFeed className="absolute inset-0" />
            </div>
          </div>

          <DoorLocksPanel />

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <UpcomingCard rows={d.upcoming} />
            <BreakfastCard rows={d.breakfasts} tomorrow={now ? kenyaHour(now) >= 11 : true} />
            <TasksCard tasks={d.tasks} />
          </div>
        </div>
      )}
    </div>
  );
}

function TodaySkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-[118px] rounded-2xl" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Skeleton className="h-64 rounded-2xl" />
          <Skeleton className="h-80 rounded-2xl" />
        </div>
        <Skeleton className="h-[600px] rounded-2xl" />
      </div>
    </div>
  );
}

// ---------- KPIs ----------

function KpiRow({ week, month }: { week: Kpis; month: Kpis }) {
  const ico = "size-4";
  return (
    <div className="grid grid-flow-dense grid-cols-2 gap-3 md:grid-cols-4">
      <KpiCard
        label="Occupancy this week"
        value={`${week.occupancy}%`}
        hint={`${week.booked_nights} of ${week.available_nights} nights booked`}
        icon={<BedDouble className={ico} />}
        tone="ocean"
      />
      <div className="col-span-2">
        <KpiCard
          label="Revenue this month"
          value={kes(month.room_revenue)}
          hint={`${kes(month.collected)} collected · ${plural(month.bookings, "booking")}`}
          icon={<Wallet className={ico} />}
          tone="brand"
        />
      </div>
      <KpiCard label="Average daily rate" value={kes(month.adr)} hint="Room revenue per booked night" icon={<TrendingUp className={ico} />} />
      <KpiCard
        label="Average rating"
        value={month.rating !== null ? `${month.rating.toFixed(1)} ★` : "—"}
        hint={month.reviews ? plural(month.reviews, "review") + " this month" : "No reviews yet this month"}
        icon={<Star className={ico} />}
      />
      <KpiCard
        label="Median reply time"
        value={month.response_minutes !== null ? `${month.response_minutes} min` : "—"}
        hint="When a question needs you"
        icon={<Timer className={ico} />}
      />
      <KpiCard
        label="Auto-answer rate"
        value={`${month.auto_answer_rate}%`}
        hint={`of ${plural(month.messages_in, "guest message")} handled by the bot`}
        icon={<Bot className={ico} />}
        tone="ocean"
      />
      <KpiCard label="Direct bookings" value={`${month.direct_share}%`} hint="No OTA commission paid" icon={<Globe className={ico} />} tone="brand" />
    </div>
  );
}

// ---------- needs attention ----------

function AttentionCard({ data, requests }: { data: TodayData; requests: PendingRequest[] }) {
  const { alerts, threads, holds } = data;
  const count = alerts.length + requests.length + threads.length + holds.length;
  return (
    <Section
      padded={false}
      title={
        <span className="flex items-center gap-2">
          Needs your attention {count > 0 && <CountPill n={count} tone="brand" />}
        </span>
      }
    >
      {count === 0 ? (
        <MiniEmpty icon={<CircleCheck className="text-success" />} title="All clear">
          No alerts, requests or unanswered guests. Asante — enjoy the sea breeze.
        </MiniEmpty>
      ) : (
        <ul className="divide-y divide-line-soft">
          {alerts.map((a) => (
            <AlertRow key={`a${a.id}`} alert={a} />
          ))}
          {requests.map((r) => (
            <RequestRow key={`r${r.id}`} req={r} />
          ))}
          {threads.map((t) => (
            <ThreadRowItem key={`t${t.id}`} thread={t} />
          ))}
          {holds.map((h) => (
            <HoldRow key={`h${h.ref}`} hold={h} />
          ))}
        </ul>
      )}
    </Section>
  );
}

function AttentionRow({
  icon, tone, title, body, aside, actions,
}: {
  icon: React.ReactNode;
  tone: "danger" | "warning" | "brand" | "ocean";
  title: React.ReactNode;
  body?: React.ReactNode;
  aside?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  const tones = {
    danger: "bg-danger-50 text-danger",
    warning: "bg-warning-50 text-warning",
    brand: "bg-brand-50 text-brand-600",
    ocean: "bg-ocean-50 text-ocean-600",
  };
  return (
    <li className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 gap-3">
        <span className={cn("grid size-9 shrink-0 place-items-center rounded-full [&_svg]:size-4", tones[tone])}>{icon}</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-semibold">{title}</div>
          {body && <div className="mt-0.5 line-clamp-2 text-[13px] text-ink-2">{body}</div>}
          {aside && <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-ink-2">{aside}</div>}
        </div>
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2 pl-12 sm:pl-0">{actions}</div>}
    </li>
  );
}

function AlertRow({ alert: a }: { alert: AlertItem }) {
  const open = a.status === "open";
  return (
    <AttentionRow
      icon={<Siren />}
      tone="danger"
      title={
        <>
          <span className="text-danger">{a.kind_label}</span>
          <Badge tone={open ? "danger" : "ocean"} dot>
            {open ? "Open" : "Acknowledged"}
          </Badge>
        </>
      }
      body={a.summary}
      aside={
        <>
          <RelTime at={a.created_at} />
          {a.booking && (
            <Link href={`/host/reservations/${a.booking}`} className="font-semibold text-ink hover:underline">
              {a.booking}
            </Link>
          )}
        </>
      }
      actions={
        <Button asChild size="sm" variant={open ? "danger" : "soft"}>
          <Link href="/host/safety">
            Open safety <ArrowRight className="size-3.5" />
          </Link>
        </Button>
      }
    />
  );
}

function RequestRow({ req: r }: { req: PendingRequest }) {
  const decide = useHostAction((approve: boolean) => post(`/api/host/requests/${r.id}/decide`, { approve }), {
    success: (_, approve) => `${r.addon} ${approve ? "approved" : "declined"} — ${r.guest} has been told by SMS`,
  });
  const details = Object.entries(r.details ?? {})
    .filter(([, v]) => v)
    .map(([k, v]) => `${k.replace(/_/g, " ")} ${v}`)
    .join(" · ");
  return (
    <AttentionRow
      icon={<Sparkles />}
      tone="warning"
      title={
        <>
          {r.addon} requested
          {r.total > 0 && <span className="font-medium text-ink-2 tabular-nums">+{kes(r.total)}</span>}
        </>
      }
      body={
        <>
          {r.guest} · {r.unit}
          {details && <> · {details}</>}
        </>
      }
      aside={
        <>
          <RelTime at={r.created_at} />
          <Link href={`/host/reservations/${r.ref}`} className="font-semibold text-ink hover:underline">
            {r.ref}
          </Link>
        </>
      }
      actions={
        <>
          <Button size="sm" variant="soft" disabled={decide.isPending} loading={decide.isPending && decide.variables === false} onClick={() => decide.mutate(false)}>
            Decline
          </Button>
          <Button size="sm" variant="dark" disabled={decide.isPending} loading={decide.isPending && decide.variables === true} onClick={() => decide.mutate(true)}>
            Approve
          </Button>
        </>
      }
    />
  );
}

function ThreadRowItem({ thread: t }: { thread: ThreadRow }) {
  const now = useNow(30_000);
  const waited = minutesSince(t.waiting_since ?? t.last_message_at, now);
  return (
    <AttentionRow
      icon={<MessageSquare />}
      tone="brand"
      title={<>{displayName(t.guest?.name, t.phone)} is waiting for a reply</>}
      body={<>“{t.last_preview}”</>}
      aside={
        <>
          <Badge tone={waited >= 30 ? "danger" : "warning"} className="tabular-nums">
            Waiting {duration(t.waiting_since ?? t.last_message_at, now)}
          </Badge>
          {t.booking && (
            <span>
              {t.booking.unit} · {t.booking.ref}
            </span>
          )}
        </>
      }
      actions={
        <Button asChild size="sm" variant="dark">
          <Link href={`/host/inbox?t=${t.id}`}>
            <MessageSquare className="size-3.5" /> Reply
          </Link>
        </Button>
      }
    />
  );
}

function HoldRow({ hold: h }: { hold: ReservationRow }) {
  return (
    <AttentionRow
      icon={<Hourglass />}
      tone="warning"
      title={<>Waiting for payment · {h.ref}</>}
      body={
        <>
          {displayName(h.guest.name, h.guest.phone)} · {h.unit.name} · {fmtRange(h.check_in, h.check_out)} · {kes(h.total)}
        </>
      }
      aside={
        h.hold_expires_at && (
          <span>
            Hold expires in <Countdown to={h.hold_expires_at} />
          </span>
        )
      }
      actions={
        <Button asChild size="sm" variant="soft">
          <Link href={`/host/reservations/${h.ref}`}>Open</Link>
        </Button>
      }
    />
  );
}

// ---------- arrivals / departures / in-house ----------

function MovementsCard({ data }: { data: TodayData }) {
  const groups = [
    { key: "arriving" as const, title: "Arriving today", icon: LogIn, rows: data.arrivals, empty: "No arrivals today." },
    { key: "leaving" as const, title: "Leaving today", icon: LogOut, rows: data.departures, empty: "No check-outs today." },
    { key: "staying" as const, title: "Staying now", icon: BedDouble, rows: data.in_house, empty: "No one is in-house right now." },
  ];
  return (
    <Section
      padded={false}
      title="Today's guests"
      action={
        <Link href="/host/reservations?status=in_house" className="text-[13px] font-semibold text-ink-2 hover:text-ink">
          In-house list →
        </Link>
      }
    >
      <div className="divide-y divide-line-soft">
        {groups.map((g) => (
          <div key={g.key}>
            <div className="flex items-center gap-2 bg-surface/60 px-5 py-2">
              <g.icon className="size-4 text-ink-2" />
              <h3 className="text-[12px] font-bold tracking-wider text-ink-2 uppercase">{g.title}</h3>
              <CountPill n={g.rows.length} />
            </div>
            {g.rows.length === 0 ? (
              <p className="px-5 py-4 text-[13px] text-ink-3">{g.empty}</p>
            ) : (
              <ul className="divide-y divide-line-soft">
                {g.rows.map((r) => (
                  <MovementRow key={r.ref} row={r} kind={g.key} />
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </Section>
  );
}

function MovementRow({ row: r, kind }: { row: ReservationRow; kind: "arriving" | "leaving" | "staying" }) {
  const guest = displayName(r.guest.name, r.guest.phone);
  let action: React.ReactNode = null;
  if (kind === "arriving" && r.status === "confirmed") {
    action = (
      <ConfirmAction
        title="Release the door code now?"
        confirmLabel="Release code"
        success={`Door code sent to ${guest} by SMS`}
        run={() => post(`/api/host/reservations/${r.ref}/release-code`, { force: true })}
        trigger={(open) => (
          <Button size="sm" variant="soft" onClick={open}>
            <KeyRound className="size-3.5" /> Release code
          </Button>
        )}
      >
        {guest} gets the {r.unit.name} door code by SMS straight away and the stay is marked as checked in. This skips the usual balance, ID and
        SIM-swap checks{r.balance_due > 0 ? ` — note ${kes(r.balance_due)} is still unpaid` : ""}.
      </ConfirmAction>
    );
  } else if (r.status === "checked_in" && kind !== "arriving") {
    action = (
      <ConfirmAction
        title={`Check out ${guest}?`}
        confirmLabel="Check out"
        success={`${guest} checked out — turnover clean scheduled`}
        run={() => post(`/api/host/reservations/${r.ref}/check-out`)}
        trigger={(open) => (
          <Button size="sm" variant="soft" onClick={open}>
            <LogOut className="size-3.5" /> Check out
          </Button>
        )}
      >
        The door code for {r.unit.name} is deactivated immediately, the guest gets a thank-you SMS and a turnover clean is assigned to housekeeping.
      </ConfirmAction>
    );
  } else if (kind === "arriving" && r.status === "checked_in") {
    action = (
      <span className="inline-flex items-center gap-1 px-2 text-[13px] font-semibold text-success">
        <CircleCheck className="size-3.5" /> Code sent
      </span>
    );
  } else if (r.status === "completed") {
    action = (
      <span className="inline-flex items-center gap-1 px-2 text-[13px] font-semibold text-ink-2">
        <CircleCheck className="size-3.5" /> Checked out
      </span>
    );
  }

  return (
    <li className="flex flex-col gap-2.5 px-5 py-3 transition-colors hover:bg-surface/50 lg:flex-row lg:items-center lg:gap-4">
      <Link href={`/host/reservations/${r.ref}`} className="group flex min-w-0 items-center gap-3 lg:w-[46%]">
        <GuestAvatar name={r.guest.name} size={36} />
        <span className="min-w-0 text-sm">
          <GuestLine name={r.guest.name} phone={r.guest.phone} nationality={r.guest.nationality} className="group-hover:underline" />
          <span className="block truncate text-[13px] text-ink-2">
            {r.unit.name} · {fmtRange(r.check_in, r.check_out)}
            {kind === "staying" ? <> · until {relDay(r.check_out) === "Today" ? "today" : fmtDate(r.check_out, "EEE d")}</> : <> · {plural(r.nights, "night")}</>}
          </span>
        </span>
      </Link>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 pl-12 lg:pl-0">
        <StatusBadge status={r.status} label={r.status_label} />
        <ChannelBadge channel={r.channel} />
        {r.balance_due > 0 && <BalanceChip balance={r.balance_due} status={r.status} />}
      </div>
      <div className="flex shrink-0 items-center justify-end gap-1">
        {action}
        <Tooltip content="Open reservation">
          <Button asChild variant="ghost" size="icon-sm" className="text-ink-2 hover:text-ink">
            <Link href={`/host/reservations/${r.ref}`} aria-label={`Open reservation ${r.ref}`}>
              <ArrowUpRight className="size-4" />
            </Link>
          </Button>
        </Tooltip>
      </div>
    </li>
  );
}

// ---------- the week ahead, breakfasts, tasks ----------

function UpcomingCard({ rows }: { rows: ReservationRow[] }) {
  return (
    <Section
      padded={false}
      title={
        <span className="flex items-center gap-2">
          <CalendarRange className="size-4 text-ink-2" /> Next 7 days
        </span>
      }
      action={
        <Link href="/host/reservations?status=upcoming" className="text-[13px] font-semibold whitespace-nowrap text-ink-2 hover:text-ink">
          All upcoming →
        </Link>
      }
    >
      {rows.length === 0 ? (
        <MiniEmpty icon={<CalendarRange />} title="No arrivals this week">
          Time for a promo? Past guests can be reached in one SMS broadcast.
        </MiniEmpty>
      ) : (
        <ul className="divide-y divide-line-soft">
          {rows.map((r) => (
            <li key={r.ref}>
              <Link href={`/host/reservations/${r.ref}`} className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-surface">
                <span className="grid w-11 shrink-0 place-items-center rounded-lg border border-line-soft py-1 leading-tight">
                  <span className="text-[10px] font-bold tracking-wider text-brand-600 uppercase">{fmtDate(r.check_in, "EEE")}</span>
                  <span className="text-base font-bold tabular-nums">{fmtDate(r.check_in, "d")}</span>
                </span>
                <span className="min-w-0 flex-1 text-sm">
                  <GuestLine name={r.guest.name} phone={r.guest.phone} nationality={r.guest.nationality} />
                  <span className="flex items-center gap-1.5 text-[13px] text-ink-2">
                    <ChannelIcon channel={r.channel} className="size-3.5 shrink-0 text-ink-3" />
                    <span className="truncate">
                      {r.unit.name} · {plural(r.nights, "night")}
                    </span>
                  </span>
                </span>
                {r.balance_due > 0 && <BalanceChip balance={r.balance_due} status={r.status} />}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function BreakfastCard({ rows, tomorrow }: { rows: BreakfastRow[]; tomorrow: boolean }) {
  const people = rows.reduce((n, r) => n + r.people, 0);
  return (
    <Section
      padded={false}
      title={
        <span className="flex items-center gap-2 whitespace-nowrap">
          <ChefHat className="size-4 text-ink-2" /> Breakfast
          <Badge tone="neutral">{tomorrow ? "Tomorrow" : "This morning"}</Badge>
        </span>
      }
      action={
        <Link href="/host/kitchen" className="text-[13px] font-semibold whitespace-nowrap text-ink-2 hover:text-ink">
          Kitchen →
        </Link>
      }
    >
      {rows.length === 0 ? (
        <MiniEmpty icon={<ChefHat />} title="No breakfasts booked">
          Guests can add breakfast by replying BREAKFAST to any SMS.
        </MiniEmpty>
      ) : (
        <>
          <div className="flex items-baseline gap-2 border-b border-line-soft px-5 py-3">
            <span className="text-2xl font-bold tabular-nums">{people}</span>
            <span className="text-[13px] text-ink-2">
              {people === 1 ? "person" : "people"} · {plural(rows.length, "home")}
            </span>
          </div>
          <ul className="divide-y divide-line-soft">
            {rows.map((r) => (
              <li key={r.ref} className="flex gap-3 px-5 py-3">
                <span className="w-12 shrink-0 pt-0.5 font-mono text-[13px] font-semibold tabular-nums">{r.time}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{r.unit}</p>
                  <p className="truncate text-[13px] text-ink-2">
                    {r.people}× {shortStyle(r.style_label)} · {r.guest}
                  </p>
                  {r.dietary && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {r.dietary.split(/[,;]/).map((x) => x.trim()).filter(Boolean).map((x) => (
                        <Badge key={x} tone="warning">
                          {x}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </Section>
  );
}

function TasksCard({ tasks }: { tasks: TaskItem[] }) {
  const now = useNow(60_000);
  return (
    <Section
      padded={false}
      title={
        <span className="flex items-center gap-2">
          <ClipboardCheck className="size-4 text-ink-2" /> Open tasks {tasks.length > 0 && <CountPill n={tasks.length} />}
        </span>
      }
      action={
        <Link href="/host/tasks" className="text-[13px] font-semibold whitespace-nowrap text-ink-2 hover:text-ink">
          Task board →
        </Link>
      }
    >
      {tasks.length === 0 ? (
        <MiniEmpty icon={<ClipboardCheck />} title="Nothing open">
          Turnover cleans are created automatically at every check-out.
        </MiniEmpty>
      ) : (
        <ul className="divide-y divide-line-soft">
          {tasks.slice(0, 8).map((t) => {
            const due = dueText(t.due_at, now);
            return (
              <li key={t.id}>
                <Link href="/host/tasks" className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-surface">
                  <TaskTypeIcon type={t.type} size={32} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{t.title}</span>
                    <span className="block truncate text-[13px] text-ink-2">
                      {[t.unit_name, t.assignee_name ?? "Unassigned"].filter(Boolean).join(" · ")}
                      {due.text && <span className={cn(due.overdue && "font-semibold text-danger")}> · {due.text}</span>}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1.5">
                    {t.status === "in_progress" && <Badge tone="ocean">In progress</Badge>}
                    <PriorityChip priority={t.priority} />
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}
