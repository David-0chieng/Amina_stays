import { Suspense } from "react";

import { SiteFooter } from "@/components/site/footer";
import { LoginDialog, MobileTabBar } from "@/components/site/header";

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <SiteFooter />
      <Suspense fallback={null}>
        <MobileTabBar />
      </Suspense>
      <LoginDialog />
    </>
  );
}
