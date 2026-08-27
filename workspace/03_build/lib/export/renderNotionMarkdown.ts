import type { FieldStructureBlock } from './types';

export interface NotionMarkdownSubtopicInput {
  title: string;
  body: string;
  /**
   * When provided (fillable delivery, decision 1's structure-extraction output),
   * renders structured blocks instead of plain body text — checklist_item/
   * user_input_blank become real `- [ ] text` syntax, which Notion's own import turns
   * into interactive to-do blocks (§2.4's confirmed finding). No separate injection
   * pipeline needed here, unlike the PDF path (§2.3's geometry-bridging problem).
   */
  fieldBlocks?: FieldStructureBlock[];
}

export interface RenderNotionMarkdownInput {
  productTitle: string;
  subtopics: NotionMarkdownSubtopicInput[];
}

function renderBlock(block: FieldStructureBlock): string {
  switch (block.fieldType) {
    case 'heading':
      return `### ${block.text}`;
    case 'checklist_item':
    case 'user_input_blank':
      return `- [ ] ${block.text}`;
    case 'table_row':
      return `| ${block.text} |`;
    case 'instructional_paragraph':
    default:
      return block.text;
  }
}

/**
 * §2.4's confirmed Notion path (decision 2) — a plain Markdown export the buyer
 * self-imports, not a real API integration (decision 2 explicitly rules that out).
 * No new library needed — this is plain string assembly, same as every other
 * pure-text output this codebase produces.
 */
export function renderNotionMarkdown(input: RenderNotionMarkdownInput): string {
  const lines: string[] = [`# ${input.productTitle}`, ''];

  for (const subtopic of input.subtopics) {
    lines.push(`## ${subtopic.title}`, '');
    if (subtopic.fieldBlocks && subtopic.fieldBlocks.length > 0) {
      for (const block of subtopic.fieldBlocks) {
        lines.push(renderBlock(block), '');
      }
    } else {
      lines.push(subtopic.body, '');
    }
  }

  return lines.join('\n');
}
