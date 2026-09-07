import { zipSync, strToU8 } from 'fflate'
import { PDFDocument, StandardFonts, PDFName, PDFDict, PDFString } from 'pdf-lib'

const relNs = 'http://schemas.openxmlformats.org/package/2006/relationships'
const officeRel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const wordNs = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const sheetNs = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const slideNs = 'http://schemas.openxmlformats.org/presentationml/2006/main'
const drawNs = 'http://schemas.openxmlformats.org/drawingml/2006/main'
const archive = (files: Record<string, string>) =>
  zipSync(Object.fromEntries(Object.entries(files).map(([path, text]) => [path, strToU8(text)])))
const contentTypes = (overrides: string) =>
  `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${overrides}</Types>`
const override = (part: string, type: string) =>
  `<Override PartName="/${part}" ContentType="application/vnd.openxmlformats-officedocument.${type}+xml"/>`
const relations = (items: string) => `<Relationships xmlns="${relNs}">${items}</Relationships>`
const rel = (id: string, type: string, target: string) =>
  `<Relationship Id="${id}" Type="${officeRel}/${type}" Target="${target}"/>`
const para = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`

export const wordFixture = () =>
  archive({
    '[Content_Types].xml': contentTypes(
      override('word/document.xml', 'wordprocessingml.document.main'),
    ),
    '_rels/.rels': relations(rel('rId1', 'officeDocument', 'word/document.xml')),
    'word/document.xml': `<w:document xmlns:w="${wordNs}"><w:body>${para('月度办公报告')}${para('正文顺序测试')}<w:tbl><w:tr><w:tc>${para('部门')}</w:tc><w:tc>${para('金额')}</w:tc></w:tr><w:tr><w:tc>${para('财务')}</w:tc><w:tc>${para('120')}</w:tc></w:tr></w:tbl><w:sectPr/></w:body></w:document>`,
  })

export const spreadsheetFixture = () =>
  archive({
    '[Content_Types].xml': contentTypes(
      override('xl/workbook.xml', 'spreadsheetml.sheet.main') +
        override('xl/worksheets/sheet1.xml', 'spreadsheetml.worksheet') +
        override('xl/worksheets/sheet2.xml', 'spreadsheetml.worksheet'),
    ),
    '_rels/.rels': relations(rel('rId1', 'officeDocument', 'xl/workbook.xml')),
    'xl/workbook.xml': `<workbook xmlns="${sheetNs}" xmlns:r="${officeRel}"><sheets><sheet name="费用" sheetId="1" r:id="rId1"/><sheet name="汇总" sheetId="2" r:id="rId2"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': relations(
      rel('rId1', 'worksheet', 'worksheets/sheet1.xml') +
        rel('rId2', 'worksheet', 'worksheets/sheet2.xml'),
    ),
    'xl/worksheets/sheet1.xml': `<worksheet xmlns="${sheetNs}"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>部门</t></is></c><c r="C1" t="inlineStr"><is><t>金额</t></is></c></row><row r="3"><c r="A3" t="inlineStr"><is><t>财务</t></is></c><c r="C3"><v>120</v></c></row></sheetData></worksheet>`,
    'xl/worksheets/sheet2.xml': `<worksheet xmlns="${sheetNs}"><sheetData><row r="1"><c r="A1"><f>1+2</f><v>3</v></c></row></sheetData></worksheet>`,
  })

export const slidesFixture = () => {
  const slide = (text: string) =>
    `<p:sld xmlns:p="${slideNs}" xmlns:a="${drawNs}"><p:cSld><p:spTree><p:sp><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`
  return archive({
    '[Content_Types].xml': contentTypes(
      override('ppt/presentation.xml', 'presentationml.presentation.main') +
        override('ppt/slides/slide1.xml', 'presentationml.slide') +
        override('ppt/slides/slide2.xml', 'presentationml.slide') +
        override('ppt/notesSlides/notesSlide1.xml', 'presentationml.notesSlide'),
    ),
    '_rels/.rels': relations(rel('rId1', 'officeDocument', 'ppt/presentation.xml')),
    'ppt/presentation.xml': `<p:presentation xmlns:p="${slideNs}" xmlns:r="${officeRel}"><p:sldIdLst><p:sldId id="256" r:id="rId1"/><p:sldId id="257" r:id="rId2"/></p:sldIdLst></p:presentation>`,
    'ppt/_rels/presentation.xml.rels': relations(
      rel('rId1', 'slide', 'slides/slide1.xml') + rel('rId2', 'slide', 'slides/slide2.xml'),
    ),
    'ppt/slides/slide1.xml': slide('办公演示第一页'),
    'ppt/slides/slide2.xml': slide('第二页计划'),
    'ppt/slides/_rels/slide1.xml.rels': relations(
      rel('rId1', 'notesSlide', '../notesSlides/notesSlide1.xml'),
    ),
    'ppt/notesSlides/notesSlide1.xml': `<p:notes xmlns:p="${slideNs}" xmlns:a="${drawNs}"><p:cSld><p:spTree><p:sp><p:nvSpPr><p:nvPr><p:ph type="body"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>第一张备注</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:notes>`,
  })
}

export async function pdfFixture(mode: 'text' | 'mixed' | 'scan' | 'encrypted' = 'text') {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  for (let i = 0; i < 2; i++) {
    const page = pdf.addPage([400, 400])
    if (mode !== 'scan' && (mode !== 'mixed' || i === 0))
      page.drawText(`Office report page ${i + 1}`, { x: 40, y: 300, font })
    else page.drawRectangle({ x: 20, y: 20, width: 100, height: 100 })
  }
  if (mode === 'encrypted') {
    const dictionary = pdf.context.obj({
      Filter: 'Standard',
      V: 1,
      R: 2,
      Length: 40,
      O: PDFString.of('x'.repeat(32)),
      U: PDFString.of('y'.repeat(32)),
      P: -4,
    }) as PDFDict
    pdf.context.trailerInfo.Encrypt = pdf.context.register(dictionary)
    pdf.catalog.set(PDFName.of('TestEncrypted'), PDFName.of('true'))
  }
  return pdf.save({ useObjectStreams: false })
}

export const oversizedArchive = () =>
  archive({
    '[Content_Types].xml': contentTypes(
      override('word/document.xml', 'wordprocessingml.document.main'),
    ),
    'word/document.xml': ' '.repeat(257 * 1024 * 1024),
  })
