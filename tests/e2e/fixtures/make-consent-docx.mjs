// Regenerates consent.docx (Word formatting test document): npx -p docx@9 node make-consent-docx.mjs
import fs from 'node:fs'
import { Document, Packer, Paragraph, TextRun, AlignmentType, TabStopType, PageBreak, LevelFormat } from 'docx'
const T = (text, o = {}) => new TextRun({ text, font: 'Times New Roman', size: 24, ...o })
const center = t => new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 240 }, children: [T(t, { bold: true })] })
const heading = (n, t) => new Paragraph({ spacing: { before: 240, after: 240 }, tabStops: [{ type: TabStopType.LEFT, position: 1080 }], children: [T(`${n}.`, { bold: true }), T('\t'), T(t, { bold: true, underline: {} })] })
const resolved = t => [
  new Paragraph({ indent: { left: 1080 }, children: [T('RESOLVED.', { bold: true, underline: {} })] }),
  new Paragraph({ indent: { left: 1080 }, alignment: AlignmentType.JUSTIFIED, spacing: { after: 240 }, children: [T(t)] })
]
const numbered = t => new Paragraph({ numbering: { reference: 'legal', level: 0 }, spacing: { after: 120 }, children: [T(t)] })
const doc = new Document({ numbering: { config: [{ reference: 'legal', levels: [{ level: 0, format: LevelFormat.LOWER_LETTER, text: '(%1)', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 1440, hanging: 360 } } } }] }] }, sections: [{ properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 } } }, children: [
  new Paragraph({ spacing: { before: 1440 } }),
  center('ACTION BY WRITTEN CONSENT'), center('OF THE STOCKHOLDERS OF'), center('FLMLNK, INC'),
  new Paragraph({ indent: { firstLine: 720 }, alignment: AlignmentType.JUSTIFIED, spacing: { after: 240 }, children: [T('Pursuant to Section 228 of the Delaware General Corporation Law and the Bylaws of FlmLnk, Inc, a Delaware corporation (the “Company”), the undersigned stockholders of the Company hereby take the following actions and adopt the following resolutions by written consent:')] }),
  heading(1, 'Certificate of Incorporation.'), ...resolved('That a copy of the Certificate of Incorporation of the Company as filed with the Delaware Secretary of State and bearing the file stamp and certification of the Delaware Secretary of State, and attached hereto as Exhibit A, is hereby accepted and ratified.'),
  heading(2, 'Bylaws.'), ...resolved('That a copy of the Bylaws of the Company as adopted by the Incorporator of the Company and approved by the Board of Directors of the Company, and attached hereto as Exhibit B, is hereby accepted and ratified.'),
  heading(3, 'Omnibus Resolution.'), ...resolved('That the officers of the Company are each hereby authorized to take all such further action and to execute all such documents as they deem necessary or appropriate to carry out the foregoing resolutions. '.repeat(3)),
  ...Array.from({ length: 6 }, (_, i) => [heading(4 + i, `Additional Matter ${i + 1}.`), ...resolved('That the Company is authorized to do the thing described in this paragraph, which is long enough to wrap across several lines so that the content flows onto a second page without an explicit page break. '.repeat(2))]).flat(),
  ...['first auto-numbered item', 'second auto-numbered item', 'third auto-numbered item'].map(numbered),
  new Paragraph({ children: [new PageBreak()] }),
  center('SIGNATURE PAGE'),
  new Paragraph({ spacing: { before: 720 }, children: [T('______________________________')] }),
  new Paragraph({ children: [T('Stockholder name')] })
] }] })
fs.writeFileSync('consent.docx', await Packer.toBuffer(doc))
