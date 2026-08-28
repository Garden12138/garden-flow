import React, { memo, useMemo } from 'react';
import ReactMarkdown, { Components, UrlTransform } from 'react-markdown';
import { SAFE_REMARK_PLUGINS } from '../../utils/markdownRemarkPlugins';

const CODE_FENCE_PATTERN = /(^|\n)```/g;

const hasUnclosedCodeFence = (content: string): boolean => {
  let count = 0;
  for (const _match of content.matchAll(CODE_FENCE_PATTERN)) {
    count += 1;
  }
  return count % 2 === 1;
};

const normalizeStreamingMarkdown = (content: string, isStreaming?: boolean): string => {
  const text = String(content || '');
  if (!isStreaming || !text) return text;
  if (!hasUnclosedCodeFence(text)) return text;
  return `${text}\n\`\`\``;
};

const splitStreamingMarkdown = (content: string): { committed: string; active: string } => {
  const text = String(content || '');
  let inFence = false;
  let lastBoundary = -1;
  for (let index = 0; index < text.length - 1; index += 1) {
    if (text.startsWith('```', index) && (index === 0 || text[index - 1] === '\n')) {
      inFence = !inFence;
      index += 2;
      continue;
    }
    if (!inFence && text[index] === '\n' && text[index + 1] === '\n') {
      lastBoundary = index + 2;
    }
  }
  if (lastBoundary <= 0) return { committed: '', active: text };
  return {
    committed: text.slice(0, lastBoundary),
    active: text.slice(lastBoundary),
  };
};

interface StreamingMarkdownProps {
  content: string;
  isStreaming?: boolean;
  components: Components;
  urlTransform?: UrlTransform;
  className?: string;
}

const MarkdownBlock = memo(({
  content,
  components,
  urlTransform,
}: {
  content: string;
  components: Components;
  urlTransform?: UrlTransform;
}) => (
  <ReactMarkdown
    remarkPlugins={SAFE_REMARK_PLUGINS}
    components={components}
    urlTransform={urlTransform}
  >
    {content}
  </ReactMarkdown>
));

MarkdownBlock.displayName = 'MarkdownBlock';

export const StreamingMarkdown = memo(({
  content,
  isStreaming,
  components,
  urlTransform,
  className,
}: StreamingMarkdownProps) => {
  const sections = useMemo(
    () => isStreaming
      ? splitStreamingMarkdown(content)
      : { committed: String(content || ''), active: '' },
    [content, isStreaming],
  );
  const activeContent = useMemo(
    () => normalizeStreamingMarkdown(sections.active, isStreaming),
    [isStreaming, sections.active],
  );

  return (
    <div className={className}>
      {sections.committed ? (
        <MarkdownBlock content={sections.committed} components={components} urlTransform={urlTransform} />
      ) : null}
      {activeContent ? (
        <MarkdownBlock content={activeContent} components={components} urlTransform={urlTransform} />
      ) : null}
    </div>
  );
});

StreamingMarkdown.displayName = 'StreamingMarkdown';
