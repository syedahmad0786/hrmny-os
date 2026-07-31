"use client";

import { useEffect } from "react";

/** Sets `document.title` to `hrmny OS · {title}` for client-rendered staff pages. */
export function usePageTitle(title: string) {
  useEffect(() => {
    const previous = document.title;
    document.title = title ? `hrmny OS · ${title}` : "hrmny OS";
    return () => {
      document.title = previous;
    };
  }, [title]);
}
