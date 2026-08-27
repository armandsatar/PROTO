import { describe, it, expect } from 'vitest';
import { validateExportRecommendationOutput, validateFieldStructureOutput, assertCanApprove } from '../lib/export/guardrail';
import type { RawExportRecommendationResponse, RawFieldStructureResponse } from '../lib/export/types';

describe('validateExportRecommendationOutput', () => {
  it('returns a validated result for a valid response', () => {
    const raw: RawExportRecommendationResponse = { output_format: 'pdf', reasoning: 'Fillable tracker needs a real PDF form.' };
    expect(validateExportRecommendationOutput(raw)).toEqual({ outputFormat: 'pdf', reasoning: 'Fillable tracker needs a real PDF form.' });
  });

  it('throws on an invalid output_format', () => {
    expect(() => validateExportRecommendationOutput({ output_format: 'epub', reasoning: 'x' })).toThrow(/invalid output_format/);
  });

  it('throws on empty reasoning', () => {
    expect(() => validateExportRecommendationOutput({ output_format: 'docx', reasoning: '' })).toThrow(/reasoning/);
  });
});

describe('validateFieldStructureOutput', () => {
  const sourceBody = "Week 1\nLog today's income\nWrite your notes here.";

  it('validates a complete blocks array, assigning sequential order', () => {
    const raw: RawFieldStructureResponse = {
      blocks: [
        { field_type: 'heading', text: 'Week 1' },
        { field_type: 'checklist_item', text: 'Log today\'s income' },
      ],
    };
    const result = validateFieldStructureOutput(raw, sourceBody);
    expect(result.blocks).toEqual([
      { fieldType: 'heading', text: 'Week 1', order: 0 },
      { fieldType: 'checklist_item', text: "Log today's income", order: 1 },
    ]);
  });

  it('drops a malformed block rather than invalidating the whole response', () => {
    const raw: RawFieldStructureResponse = {
      blocks: [
        { field_type: 'heading', text: 'Week 1' },
        { field_type: 'not_a_real_type', text: 'bad' },
        { field_type: 'checklist_item', text: '' },
      ],
    };
    const result = validateFieldStructureOutput(raw, sourceBody);
    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0].fieldType).toBe('heading');
  });

  it('drops a block whose text is not a real substring of the source body — decision 1 forbids rewriting', () => {
    const raw: RawFieldStructureResponse = {
      blocks: [
        { field_type: 'heading', text: 'Week 1' },
        { field_type: 'instructional_paragraph', text: 'This sentence was never actually in the source content.' },
      ],
    };
    const result = validateFieldStructureOutput(raw, sourceBody);
    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0].fieldType).toBe('heading');
  });

  it('throws when there is no usable blocks array at all', () => {
    expect(() => validateFieldStructureOutput({ blocks: 'not-an-array' }, sourceBody)).toThrow(/blocks/);
  });
});

describe('assertCanApprove', () => {
  it('throws when there is no current export generation', () => {
    expect(() => assertCanApprove(null)).toThrow(/no current export generation/);
  });

  it('does not throw when a current export generation exists', () => {
    expect(() => assertCanApprove('gen-1')).not.toThrow();
  });
});
