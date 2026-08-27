import { describe, it, expect } from 'vitest';
import { renderNotionMarkdown } from '../lib/export/renderNotionMarkdown';

describe('renderNotionMarkdown', () => {
  it('renders plain body text for a subtopic with no field blocks (static delivery)', () => {
    const md = renderNotionMarkdown({
      productTitle: 'Notion Budget Tracker for Freelancers',
      subtopics: [{ title: 'Module 1: Monthly Income Log', body: 'Track every invoice by client and date.' }],
    });
    expect(md).toContain('# Notion Budget Tracker for Freelancers');
    expect(md).toContain('## Module 1: Monthly Income Log');
    expect(md).toContain('Track every invoice by client and date.');
  });

  it('renders checklist_item and user_input_blank blocks as real "- [ ]" syntax (fillable delivery)', () => {
    const md = renderNotionMarkdown({
      productTitle: 'Weekly Tracker',
      subtopics: [
        {
          title: 'Week 1',
          body: 'unused when fieldBlocks are provided',
          fieldBlocks: [
            { fieldType: 'heading', text: 'Week 1 Check-In', order: 0 },
            { fieldType: 'instructional_paragraph', text: 'Review last week first.', order: 1 },
            { fieldType: 'checklist_item', text: 'Logged every invoice', order: 2 },
            { fieldType: 'user_input_blank', text: 'Total income: ____', order: 3 },
          ],
        },
      ],
    });
    expect(md).toContain('### Week 1 Check-In');
    expect(md).toContain('Review last week first.');
    expect(md).toContain('- [ ] Logged every invoice');
    expect(md).toContain('- [ ] Total income: ____');
    expect(md).not.toContain('unused when fieldBlocks are provided');
  });

  it('renders table_row blocks as a pipe-delimited line', () => {
    const md = renderNotionMarkdown({
      productTitle: 'T',
      subtopics: [{ title: 'S', body: '', fieldBlocks: [{ fieldType: 'table_row', text: 'Day 1 | 500 | On track', order: 0 }] }],
    });
    expect(md).toContain('| Day 1 | 500 | On track |');
  });
});
