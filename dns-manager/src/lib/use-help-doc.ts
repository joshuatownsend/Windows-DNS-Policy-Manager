"use client";

import { useEffect, useState, useRef, useCallback } from "react";

export function useHelpDoc(slug: string) {
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);

  const load = useCallback((docSlug: string) => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;

    setLoading(true);
    setContent("");

    fetch(`/help/${docSlug}.md`, { signal: controller.signal })
      .then((res) =>
        res.ok
          ? res.text()
          : `# Not Found\n\nCould not load help document: ${docSlug}`
      )
      .then((text) => {
        if (!controller.signal.aborted) {
          setContent(text);
          setLoading(false);
        }
      })
      .catch((err) => {
        if ((err as Error).name !== "AbortError") {
          setContent("# Error\n\nFailed to fetch help document.");
          setLoading(false);
        }
      });
  }, []);

  useEffect(() => {
    load(slug);
    return () => controllerRef.current?.abort();
  }, [slug, load]);

  return { content, loading, reload: load };
}
