'use client';

import { useMemo } from 'react';
import katex from 'katex';

interface LatexProps {
  formula: string;
  className?: string;
}

export function Latex({ formula, className = '' }: LatexProps) {
  // katex.renderToString is a pure computation - memoize instead of
  // rendering through an effect (avoids a cascading second render per row)
  const html = useMemo(() => {
    try {
      return katex.renderToString(formula, {
        throwOnError: false,
        displayMode: false,
        trust: true,
        strict: false,
      });
    } catch {
      return null;
    }
  }, [formula]);

  if (!html) {
    return <span className={className}>{formula}</span>;
  }

  return (
    <span
      className={className}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
