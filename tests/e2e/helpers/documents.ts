import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FIXTURES_DIR = path.resolve(__dirname, '../../fixtures/documents');

const DOC_NAMES = [
  'dummy-aadhaar',
  'dummy-pan',
  'dummy-bank-proof',
  'dummy-photo',
  'dummy-education',
  'dummy-experience',
  'dummy-address-proof',
  'dummy-epf-form',
  'dummy-nda',
  'dummy-employment-contract',
  'dummy-bgv-consent',
] as const;

export type DocType = (typeof DOC_NAMES)[number];

/**
 * Generate a minimal valid PDF with visible text.
 * PDF structure: header, object with text, cross-reference table, trailer.
 */
function generateMinimalPdf(text: string): Buffer {
  const content = `
BT
/F1 12 Tf
50 750 Td
(${text.replace(/[()\\]/g, '\\$&')}) Tj
ET
  `.trim();

  const esc = (s: string) => s.replace(/[\r\n]+/g, ' ').trim();

  const objects = [
    `1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj`,
    `2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj`,
    `3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> >> endobj`,
    `4 0 obj << /Length ${content.length} >> stream\n${content}\nendstream\nendobj`,
  ];

  const body = objects.join('\n');
  const offset = 'PDF-1.4\n%\xFF\xFF\xFF\xFF\n'.length;
  const xrefOffset = Buffer.byteLength(body, 'utf8') + offset;
  const xref = `xref\n0 5\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \n0000000115 00000 n \n0000000266 00000 n \ntrailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return Buffer.concat([
    Buffer.from(`%PDF-1.4\n%\xFF\xFF\xFF\xFF\n`),
    Buffer.from(body, 'utf8'),
    Buffer.from('\n' + xref, 'utf8'),
  ]);
}

export function getDocPath(docType: DocType): string {
  return path.join(FIXTURES_DIR, `${docType}.pdf`);
}

export function ensureDummyDocuments(): void {
  if (!fs.existsSync(FIXTURES_DIR)) {
    fs.mkdirSync(FIXTURES_DIR, { recursive: true });
  }

  for (const name of DOC_NAMES) {
    const filePath = getDocPath(name);
    if (!fs.existsSync(filePath)) {
      const label = name.replace('dummy-', '').replace(/-/g, ' ').toUpperCase();
      const text = `DUMMY TEST DOCUMENT - ${label}\nFor HRMS2 E2E Testing Only\nE2E Run: ${new Date().toISOString()}`;
      fs.writeFileSync(filePath, generateMinimalPdf(text));
    }
  }
}

export { DOC_NAMES, FIXTURES_DIR };
