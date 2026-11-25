"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Download, Globe, LogOut, Megaphone, ShieldCheck, Trash2, UserRound } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";

import { useLogout, useMe } from "@/components/providers";
import { AuthGate } from "@/components/site/auth-gate";
import { SiteHeader } from "@/components/site/header";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/input";
import { Avatar, Badge } from "@/components/ui/misc";
import { Switch } from "@/components/ui/overlays";
import { get, patch, post } from "@/lib/api";
import { fmtDate } from "@/lib/format";
import type { Me } from "@/lib/types";
import { COUNTRIES } from "@/lib/utils";

export function AccountView() {
  return (
    <AuthGate title="Log in to your account">
      <Account />
    </AuthGate>
  );
}

function Account() {
  const qc = useQueryClient();
  const router = useRouter();
  const logout = useLogout();
  const { data: me } = useMe();
  const [form, setForm] = React.useState({ name: me?.name ?? "", email: me?.email ?? "", lang: me?.lang ?? "en", nationality: me?.nationality ?? "", preferred_channel: me?.preferred_channel ?? "sms" });
  const [saving, setSaving] = React.useState(false);
  const [id, setId] = React.useState({ id_type: "passport", id_number: "", consent: false });
  const [confirm, setConfirm] = React.useState("");
  if (!me) return null;

  async function save(body: Partial<Me> | typeof form, msg = "Saved") {
    setSaving(true);
    try {
      qc.setQueryData(["me"], await patch<Me>("/api/me", body));
      toast.success(msg);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function exportData() {
    try {
      const data = await get<unknown>("/api/me/export");
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
      const a = Object.assign(document.createElement("a"), { href: url, download: "amina-stays-my-data.json" });
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function erase() {
    try {
      const r = await post<{ erased: boolean; register_kept: boolean }>("/api/me/erase");
      toast.success(r.register_kept ? "Done. Only the legally required guest-register entry remains." : "Your personal data has been erased.");
      await qc.invalidateQueries();
      router.push("/");
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <>
      <SiteHeader />
      <main className="container-narrow max-w-[880px] pt-10 pb-24">
        <div className="flex items-center gap-5">
          <Avatar name={me.name || me.phone} size={72} />
          <div>
            <h1 className="text-[28px] font-bold tracking-tight">{me.name || "Your account"}</h1>
            <p className="text-ink-2">{me.phone} · your phone number is your login everywhere</p>
          </div>
        </div>

        <section className="mt-12">
          <h2 className="flex items-center gap-2 text-[22px] font-bold"><UserRound className="size-5" /> Personal info</h2>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <Field label="Name"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            <Field label="Email"><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
            <Field label="Messages in">
              <Select value={form.lang} onChange={(e) => setForm({ ...form, lang: e.target.value as Me["lang"] & string })}>
                {(me.languages ?? [["en", "English"]]).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </Select>
            </Field>
            <Field label="Nationality">
              <Select value={form.nationality} onChange={(e) => setForm({ ...form, nationality: e.target.value })}>
                <option value="">Select…</option>
                {COUNTRIES.map(([c, n]) => <option key={c} value={c}>{n}</option>)}
              </Select>
            </Field>
            <Field label="Updates by" hint="WhatsApp needs a WhatsApp number on this phone">
              <Select value={form.preferred_channel} onChange={(e) => setForm({ ...form, preferred_channel: e.target.value as "sms" | "whatsapp" })}>
                <option value="sms">SMS</option><option value="whatsapp">WhatsApp</option>
              </Select>
            </Field>
          </div>
          <Button className="mt-5" onClick={() => save(form)} loading={saving}>Save changes</Button>
        </section>

        <section className="mt-12 border-t border-line-soft pt-10">
          <h2 className="flex items-center gap-2 text-[22px] font-bold"><ShieldCheck className="size-5" /> Identity for the guest register</h2>
          {me.identity?.last4 ? (
            <div className="mt-4 flex flex-wrap items-center gap-3 rounded-2xl border border-line-soft p-5">
              <Badge tone="success">On file</Badge>
              <span className="font-semibold">{me.identity.type_label} {me.identity.last4}</span>
              <span className="text-sm text-ink-2">added {fmtDate(me.identity.submitted_at, "d MMM yyyy")} · stored encrypted</span>
            </div>
          ) : (
            <p className="mt-2 text-ink-2">Not added yet. Kenyan law requires a guest register — add it once and every future stay is ready.</p>
          )}
          <div className="mt-5 grid gap-4 sm:grid-cols-3">
            <Field label="Document">
              <Select value={id.id_type} onChange={(e) => setId({ ...id, id_type: e.target.value })}>
                {(me.id_types ?? []).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </Select>
            </Field>
            <Field label={me.identity?.last4 ? "Replace with number" : "Number"} className="sm:col-span-2"><Input value={id.id_number} onChange={(e) => setId({ ...id, id_number: e.target.value })} /></Field>
          </div>
          <label className="mt-4 flex items-start gap-3 text-sm">
            <input type="checkbox" className="mt-0.5 size-4 accent-ink" checked={id.consent} onChange={(e) => setId({ ...id, consent: e.target.checked })} />
            <span>I agree to my ID number being stored encrypted for the guest register, as explained in the <Link href="/privacy" className="underline">privacy notice</Link>.</span>
          </label>
          <Button className="mt-4" variant="soft" disabled={!id.id_number || !id.consent} onClick={async () => {
            try {
              qc.setQueryData(["me"], await post<Me>("/api/me/identity", { ...id, nationality: form.nationality }));
              setId({ ...id, id_number: "" });
              toast.success("ID saved securely");
            } catch (e) {
              toast.error((e as Error).message);
            }
          }}>Save ID</Button>
        </section>

        <section className="mt-12 border-t border-line-soft pt-10">
          <h2 className="flex items-center gap-2 text-[22px] font-bold"><Megaphone className="size-5" /> Notifications</h2>
          <div className="mt-5 flex items-start justify-between gap-6 rounded-2xl border border-line-soft p-5">
            <div>
              <p className="font-semibold">Offers &amp; seasonal deals</p>
              <p className="text-sm text-ink-2">Occasional SMS, never after 6pm. Reply STOP to any message to opt out. Booking messages (confirmations, codes, receipts) always come through.</p>
            </div>
            <Switch checked={!!me.marketing_opt_in} onCheckedChange={(v) => save({ marketing_opt_in: v }, v ? "You'll get our offers" : "Unsubscribed from offers")} aria-label="Offers by SMS" />
          </div>
        </section>

        <section className="mt-12 border-t border-line-soft pt-10">
          <h2 className="flex items-center gap-2 text-[22px] font-bold"><Globe className="size-5" /> Your data</h2>
          <p className="mt-2 text-ink-2">Your rights under Kenya&apos;s Data Protection Act, 2019. Read the <Link href="/privacy" className="underline">privacy notice</Link>.</p>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <button onClick={exportData} className="flex items-start gap-4 rounded-2xl border border-line-soft p-5 text-left hover:border-ink">
              <Download className="mt-0.5 size-5" />
              <span><b className="block">Download my data</b><span className="text-sm text-ink-2">Bookings, messages and profile as a JSON file</span></span>
            </button>
            <Dialog>
              <DialogTrigger asChild>
                <button className="flex items-start gap-4 rounded-2xl border border-line-soft p-5 text-left hover:border-danger">
                  <Trash2 className="mt-0.5 size-5 text-danger" />
                  <span><b className="block">Erase my data</b><span className="text-sm text-ink-2">Remove your personal information</span></span>
                </button>
              </DialogTrigger>
              <DialogContent title="Erase your personal data?" size="sm">
                <div className="space-y-4 p-6 text-[15px]">
                  <p className="text-ink-2">We&apos;ll delete your email, preferences, wishlist and message history, stop all offers and log you out. Any upcoming booking stays valid and its essential messages (door code, receipts) still reach you.</p>
                  <p className="text-ink-2">If you&apos;ve stayed with us, your name, ID and stay dates remain in the guest register for the 5 years Kenyan tourism law requires, then are erased automatically; financial records are kept for KRA.</p>
                  <Field label='Type "ERASE" to confirm'><Input value={confirm} onChange={(e) => setConfirm(e.target.value)} /></Field>
                  <Button variant="danger" size="lg" className="w-full" disabled={confirm !== "ERASE"} onClick={erase}>Erase my data</Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </section>

        <Button variant="ghost" className="mt-12" onClick={logout}><LogOut className="size-4" /> Log out</Button>
      </main>
    </>
  );
}
