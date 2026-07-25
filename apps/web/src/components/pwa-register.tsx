"use client";

import { useEffect } from "react";

function hrmnyWorker(registration: ServiceWorkerRegistration) {
  return [
    registration.active,
    registration.waiting,
    registration.installing,
  ].some((worker) => worker && new URL(worker.scriptURL).pathname === "/sw.js");
}

export async function syncHrmnyPwa(enabled: boolean) {
  for (const link of document.querySelectorAll("link[data-hrmny-pwa]"))
    link.remove();
  if (enabled) {
    const link = document.createElement("link");
    link.rel = "manifest";
    link.href = "/manifest.webmanifest";
    link.dataset.hrmnyPwa = "true";
    document.head.append(link);
    if ("serviceWorker" in navigator)
      await navigator.serviceWorker.register("/sw.js", { scope: "/" });
    return;
  }
  if ("serviceWorker" in navigator)
    for (const registration of await navigator.serviceWorker.getRegistrations())
      if (hrmnyWorker(registration)) await registration.unregister();
  if ("caches" in globalThis)
    for (const key of await caches.keys())
      if (key.startsWith("hrmny-shell-")) await caches.delete(key);
}

export function PwaRegister({ enabled }: { enabled: boolean }) {
  useEffect(() => {
    void syncHrmnyPwa(enabled);
  }, [enabled]);
  return null;
}
