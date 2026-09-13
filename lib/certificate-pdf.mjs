import puppeteer from 'puppeteer';
import { PDFDocument } from 'pdf-lib';
import { readFile } from 'node:fs/promises';
import { certificateTemplate } from '../public/js/certificate-template.js';
export const pdfFilename = certificate => `Bonafide_${certificate.registrationNumber.replace(/[^a-zA-Z0-9_-]/g, '_')}_${String(certificate.number).padStart(6, '0')}.pdf`;
let active = false;
export async function renderCertificatePdf(certificate) {
  if (active) throw Object.assign(new Error('Another PDF is being prepared. Please try again shortly.'), { status: 429 });
  active = true;
  let browser;
  try {
    let html = certificateTemplate(certificate);
    for (const name of ['certificate-header.jpg', 'certificate-watermark.jpeg']) {
      const data = await readFile(new URL('../public/images/' + name, import.meta.url));
      html = html.replace('/images/' + name, 'data:image/jpeg;base64,' + data.toString('base64'));
    }
    const css = await readFile(new URL('../public/css/certificate.css', import.meta.url), 'utf8');
    browser = await puppeteer.launch({ headless: true, timeout: 30000 });
    const page = await browser.newPage();
    await page.setJavaScriptEnabled(false);
    await page.setRequestInterception(true);
    page.on('request', request => request.url().startsWith('data:') ? request.continue() : request.abort());
    await page.setContent(`<html><head><meta charset="utf-8"><style>${css}</style></head><body>${html}</body></html>`, { waitUntil: 'load', timeout: 15000 });
    await page.emulateMediaType('print');
    const fits = await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all([...document.images].map(image => image.decode()));
      const frame = document.querySelector('.certificate-frame');
      return frame.scrollHeight <= frame.clientHeight + 1 && frame.scrollWidth <= frame.clientWidth + 1;
    });
    if (!fits) throw new Error('Certificate content exceeds one page.');
    const bytes = await page.pdf({ preferCSSPageSize: true, printBackground: true, displayHeaderFooter: false, scale: 1, timeout: 15000 });
    const pdf = await PDFDocument.load(bytes);
    if (pdf.getPageCount() !== 1) throw new Error('Certificate must be one page.');
    return Buffer.from(bytes);
  } catch {
    throw Object.assign(new Error('PDF could not be prepared. Please try again or use Print Certificate. Your certificate number and issue date are saved.'), { status: 503 });
  } finally {
    try { if (browser) await browser.close(); } finally { active = false; }
  }
}
