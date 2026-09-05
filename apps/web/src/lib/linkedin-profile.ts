/** Only a public member profile. Never credentials, message-prefill or redirect URLs. */
export function linkedinProfileUrl(
  value: string | null | undefined,
): string | null {
  try {
    const url = new URL(value ?? "");
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      !/^(?:www\.|[a-z]{2}\.)?linkedin\.com$/i.test(url.hostname) ||
      !/^\/in\/[a-zA-Z0-9_%-]+\/?$/.test(url.pathname)
    )
      return null;
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}
