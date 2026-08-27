import { Document, Page, Text, View, Image as PdfImage, StyleSheet, renderToBuffer } from '@react-pdf/renderer';
import { PDFDocument } from 'pdf-lib';

export interface PdfSubtopicInput {
  title: string;
  body: string;
}

export interface RenderPdfInput {
  productTitle: string;
  coverImageBase64: string;
  coverImageMimeType: 'image/jpeg' | 'image/png';
  subtopics: PdfSubtopicInput[];
}

const styles = StyleSheet.create({
  coverPage: { width: '100%', height: '100%' },
  coverImage: { width: '100%', height: '100%', objectFit: 'cover' },
  contentPage: { padding: 48, fontSize: 11, fontFamily: 'Helvetica' },
  heading: { fontSize: 16, fontWeight: 700, marginTop: 18, marginBottom: 8 },
  body: { fontSize: 11, lineHeight: 1.5, marginBottom: 6 },
});

/**
 * §2.2's chosen layout engine, live-spiked in this increment — real automatic
 * pagination (unlike Satori, which has none at all, §2.2's own finding). The cover is
 * a dedicated, non-wrapping full-bleed page (§2.7); every subtopic's heading+body live
 * as siblings on one flowing content Page so @react-pdf/renderer's own overflow
 * handling creates however many physical pages the confirmed content actually needs —
 * no manual pagination math anywhere in this function.
 */
export async function renderPdfDocument(input: RenderPdfInput): Promise<Buffer> {
  const coverDataUri = `data:${input.coverImageMimeType};base64,${input.coverImageBase64}`;

  const doc = (
    <Document title={input.productTitle}>
      <Page size="LETTER" style={styles.coverPage} wrap={false}>
        <PdfImage src={coverDataUri} style={styles.coverImage} />
      </Page>
      <Page size="LETTER" style={styles.contentPage}>
        {input.subtopics.map((s, i) => (
          <View key={i}>
            <Text style={styles.heading}>{s.title}</Text>
            <Text style={styles.body}>{s.body}</Text>
          </View>
        ))}
      </Page>
    </Document>
  );

  return renderToBuffer(doc);
}

/** Real physical page count from the rendered file — §5 rule 4's sanity-band input. */
export async function countPdfPages(buffer: Buffer): Promise<number> {
  const pdfDoc = await PDFDocument.load(buffer);
  return pdfDoc.getPageCount();
}
