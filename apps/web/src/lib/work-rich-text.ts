export type WorkRichTextToken =
  | { type: "text"; value: string }
  | {
      type: "mention";
      value: string;
      mentionType: "person" | "project" | "task" | "message" | "team";
      mentionId: string;
    }
  | { type: "link"; value: string; href: string }
  | {
      type: "bold" | "underline" | "strike" | "code" | "italic";
      value: string;
    };

const UUID =
  "[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const TOKEN = `(@\\[([^\\]]+)\\]\\((person|project|task|message|team):(${UUID})\\)|\\[([^\\]]+)\\]\\((https?:\\/\\/[^\\s)]+|mailto:[^\\s)]+)\\)|\\*\\*([^*]+)\\*\\*|__([^_]+)__|~([^~]+)~|\`([^\`]+)\`|_([^_]+)_|\\*([^*\\n]+)\\*)`;

export function parseWorkRichTextInline(value: string): WorkRichTextToken[] {
  const tokens: WorkRichTextToken[] = [];
  const pattern = new RegExp(TOKEN, "gi");
  let offset = 0;
  for (const match of value.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > offset)
      tokens.push({ type: "text", value: value.slice(offset, index) });
    if (match[2] && match[3] && match[4])
      tokens.push({
        type: "mention",
        value: match[2],
        mentionType: match[3].toLowerCase() as Extract<
          WorkRichTextToken,
          { type: "mention" }
        >["mentionType"],
        mentionId: match[4].toLowerCase(),
      });
    else if (match[5] && match[6])
      tokens.push({ type: "link", value: match[5], href: match[6] });
    else if (match[7]) tokens.push({ type: "bold", value: match[7] });
    else if (match[8]) tokens.push({ type: "underline", value: match[8] });
    else if (match[9]) tokens.push({ type: "strike", value: match[9] });
    else if (match[10]) tokens.push({ type: "code", value: match[10] });
    else if (match[11]) tokens.push({ type: "italic", value: match[11] });
    else if (match[12]) tokens.push({ type: "bold", value: match[12] });
    offset = index + match[0].length;
  }
  if (offset < value.length)
    tokens.push({ type: "text", value: value.slice(offset) });
  return tokens;
}

export function workMentionEmployeeIds(value: string) {
  return [
    ...new Set(
      parseWorkRichTextInline(value).flatMap((token) =>
        token.type === "mention" && token.mentionType === "person"
          ? [token.mentionId]
          : [],
      ),
    ),
  ];
}
