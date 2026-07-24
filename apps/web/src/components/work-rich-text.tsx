"use client";

import { type FocusEventHandler, type KeyboardEvent, useRef } from "react";
import {
  parseWorkRichTextInline,
  type WorkRichTextToken,
} from "@/lib/work-rich-text";

export type WorkMentionOption = {
  id: string;
  label: string;
  type: "person" | "project" | "task" | "message" | "team";
};

function mentionHref(token: Extract<WorkRichTextToken, { type: "mention" }>) {
  if (token.mentionType === "project" || token.mentionType === "task")
    return "/work";
  if (token.mentionType === "message" || token.mentionType === "team")
    return "/work/messages";
  return null;
}

function inline(value: string) {
  return parseWorkRichTextInline(value).map((token, index) => {
    const key = `${token.type}:${index}`;
    if (token.type === "bold") return <strong key={key}>{token.value}</strong>;
    if (token.type === "underline") return <u key={key}>{token.value}</u>;
    if (token.type === "strike") return <del key={key}>{token.value}</del>;
    if (token.type === "italic") return <em key={key}>{token.value}</em>;
    if (token.type === "code")
      return (
        <code
          className="rounded bg-sand/60 px-1 font-mono text-[0.9em]"
          key={key}
        >
          {token.value}
        </code>
      );
    if (token.type === "link")
      return (
        <a
          className="text-ochre underline underline-offset-2"
          href={token.href}
          key={key}
          rel="noreferrer"
          target={token.href.startsWith("http") ? "_blank" : undefined}
        >
          {token.value}
        </a>
      );
    if (token.type === "mention") {
      const href = mentionHref(token);
      const content = `@${token.value}`;
      return href ? (
        <a
          className="rounded bg-ochre/10 px-1 font-medium text-ochre"
          href={href}
          key={key}
        >
          {content}
        </a>
      ) : (
        <span
          className="rounded bg-ochre/10 px-1 font-medium text-ochre"
          key={key}
        >
          {content}
        </span>
      );
    }
    return <span key={key}>{token.value}</span>;
  });
}

export function WorkRichText({
  value,
  className = "",
}: {
  value: string;
  className?: string;
}) {
  const lines = value.split("\n");
  const blocks: React.ReactNode[] = [];
  for (let index = 0; index < lines.length;) {
    const bullet = /^[-*] (.*)$/.exec(lines[index]!);
    const numbered = /^\d+\. (.*)$/.exec(lines[index]!);
    if (bullet || numbered) {
      const items: string[] = [];
      const pattern = bullet ? /^[-*] (.*)$/ : /^\d+\. (.*)$/;
      while (index < lines.length) {
        const match = pattern.exec(lines[index]!);
        if (!match) break;
        items.push(match[1]!);
        index += 1;
      }
      const List = bullet ? "ul" : "ol";
      blocks.push(
        <List
          className={`${bullet ? "list-disc" : "list-decimal"} ml-5 space-y-1`}
          key={`list:${index}`}
        >
          {items.map((item, itemIndex) => (
            <li key={itemIndex}>{inline(item)}</li>
          ))}
        </List>,
      );
      continue;
    }
    blocks.push(
      lines[index] ? (
        <p className="whitespace-pre-wrap" key={`line:${index}`}>
          {inline(lines[index]!)}
        </p>
      ) : (
        <br key={`line:${index}`} />
      ),
    );
    index += 1;
  }
  return (
    <div className={`work-rich-text space-y-1 ${className}`}>{blocks}</div>
  );
}

export function WorkRichTextEditor({
  value,
  onChange,
  ariaLabel,
  placeholder,
  maxLength,
  mentions = [],
  readOnly = false,
  onBlur,
  className = "",
}: {
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
  placeholder?: string;
  maxLength?: number;
  mentions?: WorkMentionOption[];
  readOnly?: boolean;
  onBlur?: FocusEventHandler<HTMLTextAreaElement>;
  className?: string;
}) {
  const textarea = useRef<HTMLTextAreaElement>(null);

  function replaceSelection(before: string, after = before, fallback = "text") {
    const element = textarea.current;
    if (!element) return;
    const start = element.selectionStart;
    const end = element.selectionEnd;
    const selected = value.slice(start, end) || fallback;
    const next = `${value.slice(0, start)}${before}${selected}${after}${value.slice(end)}`;
    onChange(next);
    requestAnimationFrame(() => {
      element.focus();
      element.setSelectionRange(
        start + before.length,
        start + before.length + selected.length,
      );
    });
  }

  function insertText(text: string) {
    const element = textarea.current;
    if (!element) return;
    const start = element.selectionStart;
    const end = element.selectionEnd;
    onChange(`${value.slice(0, start)}${text}${value.slice(end)}`);
    requestAnimationFrame(() => {
      element.focus();
      element.setSelectionRange(start + text.length, start + text.length);
    });
  }

  function prefixSelection(prefix: string) {
    const element = textarea.current;
    if (!element) return;
    const start =
      value.lastIndexOf("\n", Math.max(0, element.selectionStart - 1)) + 1;
    const endLine = value.indexOf("\n", element.selectionEnd);
    const end = endLine < 0 ? value.length : endLine;
    const selected = value.slice(start, end);
    onChange(
      `${value.slice(0, start)}${selected
        .split("\n")
        .map(
          (line, index) =>
            `${prefix === "1. " ? `${index + 1}. ` : prefix}${line}`,
        )
        .join("\n")}${value.slice(end)}`,
    );
  }

  function shortcut(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (!(event.ctrlKey || event.metaKey)) return;
    const key = event.key.toLowerCase();
    const format: [string, string] | null =
      key === "b"
        ? ["**", "**"]
        : key === "i"
          ? ["_", "_"]
          : key === "u"
            ? ["__", "__"]
            : key === "k"
              ? ["[", "](https://)"]
              : event.shiftKey && key === "x"
                ? ["~", "~"]
                : event.shiftKey && key === "m"
                  ? ["`", "`"]
                  : null;
    if (event.shiftKey && event.code === "Digit8") {
      event.preventDefault();
      prefixSelection("* ");
    } else if (event.shiftKey && event.code === "Digit7") {
      event.preventDefault();
      prefixSelection("1. ");
    } else if (format) {
      event.preventDefault();
      replaceSelection(format[0], format[1]);
    }
  }

  return (
    <div
      className={`overflow-hidden rounded-lg border border-sand bg-white ${className}`}
    >
      {!readOnly ? (
        <div
          className="flex flex-wrap items-center gap-1 border-b border-sand p-1"
          role="toolbar"
          aria-label="Text formatting"
        >
          {[
            ["Bold", "**", "**"],
            ["Italic", "_", "_"],
            ["Underline", "__", "__"],
            ["Strike", "~", "~"],
            ["Code", "`", "`"],
            ["Link", "[", "](https://)"],
          ].map(([label, before, after]) => (
            <button
              className="rounded px-2 py-1 text-xs font-medium hover:bg-sand/50"
              key={label}
              type="button"
              onClick={() => replaceSelection(before!, after!)}
            >
              {label}
            </button>
          ))}
          <button
            className="rounded px-2 py-1 text-xs hover:bg-sand/50"
            type="button"
            onClick={() => prefixSelection("* ")}
          >
            Bullets
          </button>
          <button
            className="rounded px-2 py-1 text-xs hover:bg-sand/50"
            type="button"
            onClick={() => prefixSelection("1. ")}
          >
            Numbered
          </button>
          {mentions.length ? (
            <select
              aria-label="Insert mention"
              className="ml-auto rounded border border-sand px-2 py-1 text-xs"
              defaultValue=""
              onChange={(event) => {
                const option = mentions.find(
                  (candidate) =>
                    `${candidate.type}:${candidate.id}` === event.target.value,
                );
                if (option)
                  insertText(`@[${option.label}](${option.type}:${option.id})`);
                event.target.value = "";
              }}
            >
              <option value="">Mention…</option>
              {mentions.map((option) => (
                <option
                  key={`${option.type}:${option.id}`}
                  value={`${option.type}:${option.id}`}
                >
                  {option.label} · {option.type}
                </option>
              ))}
            </select>
          ) : null}
        </div>
      ) : null}
      <textarea
        ref={textarea}
        aria-label={ariaLabel}
        className="min-h-24 w-full resize-y bg-transparent px-3 py-2 text-sm outline-none"
        maxLength={maxLength}
        placeholder={placeholder}
        readOnly={readOnly}
        value={value}
        onBlur={onBlur}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={shortcut}
      />
    </div>
  );
}
