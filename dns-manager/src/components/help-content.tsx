"use client";

import ReactMarkdown from "react-markdown";

export function HelpSpinner() {
  return (
    <div className="flex items-center justify-center py-16">
      <div className="h-5 w-5 border-2 border-cyan/30 border-t-cyan rounded-full animate-spin" />
    </div>
  );
}

export function HelpMarkdown({ content }: { content: string }) {
  return (
    <article className="help-content">
      <ReactMarkdown>{content}</ReactMarkdown>
    </article>
  );
}
