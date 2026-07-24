import { notFound } from "next/navigation";
import { getPublicDigitalCard } from "@/server/trpc/digital-cards-router";
import { ShareActions } from "./share-actions";

export const dynamic = "force-dynamic";

export default async function PublicDigitalCardPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const card = await getPublicDigitalCard(slug);
  if (!card) notFound();

  const title = card.displayName ?? card.companyName;
  return (
    <main className="grid min-h-screen place-items-center bg-[#F5F0E8] p-5">
      <article
        className="w-full max-w-md rounded-3xl border border-black/10 bg-white p-7 shadow-xl"
        style={{ "--card-accent": card.accentColor } as React.CSSProperties}
      >
        <header className="text-center">
          {card.logoUrl ? (
            <img
              className="mx-auto mb-5 h-12 max-w-48 object-contain"
              src={card.logoUrl}
              alt={`${card.companyName} logo`}
            />
          ) : (
            <p
              className="mb-5 font-display text-xl font-semibold"
              style={{ color: card.accentColor }}
            >
              {card.companyName}
            </p>
          )}
          {card.photoUrl ? (
            <img
              className="mx-auto mb-4 h-24 w-24 rounded-full object-cover"
              src={card.photoUrl}
              alt=""
            />
          ) : null}
          {card.displayName ? (
            <h1 className="font-display text-3xl font-semibold">
              {card.displayName}
            </h1>
          ) : null}
          {card.jobTitle ? (
            <p className="mt-1 text-neutral-600">{card.jobTitle}</p>
          ) : null}
          {card.location ? (
            <p className="mt-1 text-sm text-neutral-500">{card.location}</p>
          ) : null}
        </header>

        {card.bio ? (
          <p className="mt-6 text-center text-sm leading-6 text-neutral-700">
            {card.bio}
          </p>
        ) : null}

        <div className="mt-6 grid gap-2 text-sm">
          {card.workEmail ? (
            <Contact href={`mailto:${card.workEmail}`} label={card.workEmail} />
          ) : null}
          {card.phone ? (
            <Contact href={`tel:${card.phone}`} label={card.phone} />
          ) : null}
          {card.website ? (
            <Contact href={card.website} label="Website" external />
          ) : null}
          {card.linkedinUrl ? (
            <Contact href={card.linkedinUrl} label="LinkedIn" external />
          ) : null}
        </div>

        <ShareActions title={title} />
      </article>
    </main>
  );
}

function Contact({
  href,
  label,
  external = false,
}: {
  href: string;
  label: string;
  external?: boolean;
}) {
  return (
    <a
      className="rounded-xl border border-black/10 px-4 py-3 text-center font-medium hover:bg-black/[0.03]"
      href={href}
      {...(external ? { target: "_blank", rel: "noreferrer" } : {})}
    >
      {label}
    </a>
  );
}
