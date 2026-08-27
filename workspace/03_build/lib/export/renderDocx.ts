import { Document, Packer, Paragraph, HeadingLevel, ImageRun } from 'docx';

export interface DocxSubtopicInput {
  title: string;
  body: string;
}

export interface RenderDocxInput {
  productTitle: string;
  coverImageBuffer: Buffer;
  coverImageMimeType: 'image/jpeg' | 'image/png';
  subtopics: DocxSubtopicInput[];
}

/**
 * §2.6's confirmed Docx path — static only, no interactive-form-field story (a
 * disclosed limitation, not a silent gap: Docx's own legacy form-field/content-control
 * mechanism was never researched or built here). The cover is a full-page-but-margined
 * image on the first page, not a true bleed (§2.6's own disclosed fidelity gap —
 * OOXML's page model has no full-bleed concept the way a PDF does).
 */
export async function renderDocxDocument(input: RenderDocxInput): Promise<Buffer> {
  const imageType = input.coverImageMimeType === 'image/png' ? 'png' : 'jpg';

  const doc = new Document({
    title: input.productTitle,
    sections: [
      {
        properties: {},
        children: [
          new Paragraph({
            children: [
              new ImageRun({
                data: input.coverImageBuffer,
                type: imageType,
                transformation: { width: 468, height: 624 },
              }),
            ],
          }),
          ...input.subtopics.flatMap((s) => [
            new Paragraph({ text: s.title, heading: HeadingLevel.HEADING_1 }),
            new Paragraph({ text: s.body }),
          ]),
        ],
      },
    ],
  });

  return Packer.toBuffer(doc);
}
