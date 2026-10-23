import { jsPDF } from 'jspdf';
import { DEFAULT_QUOTATION_TERMS } from './quotationTerms';
const Mahavirlogo = '/mahavirlogo.png';

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL_IMG || '';

// ── Colour palette (black & gold) ─────────────────────────────────────────
const C = {
  black      : [10,  10,  10],
  blackSoft  : [20,  20,  20],
  blackCard  : [28,  28,  28],
  blackRow   : [35,  35,  35],
  gold       : [212, 175,  55],
  goldLight  : [232, 200,  90],
  goldMuted  : [160, 130,  40],
  white      : [255, 255, 255],
  greyLight  : [200, 200, 200],
  greyMid    : [140, 140, 140],
  greyDark   : [ 80,  80,  80],
};

// ── Convert image URL → base64 (needed for jsPDF) ────────────────────────
async function imageUrlToBase64(url) {
  try {
    const res  = await fetch(url);
    const blob = await res.blob();
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror  = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

// ── Convert imported Vite asset → base64 ─────────────────────────────────
async function assetToBase64(importedAsset) {
  if (!importedAsset) return null;
  if (importedAsset.startsWith('data:')) return importedAsset;
  const url = importedAsset.startsWith('http')
    ? importedAsset
    : window.location.origin + importedAsset;
  return imageUrlToBase64(url);
}

// ── Main PDF generator ────────────────────────────────────────────────────
export async function generateQuotationPDF(quotation, selectedColumns, mode) {
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  const pageWidth  = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin     = 10;
  const usable     = pageWidth - 2 * margin;
  const ROW_H      = 14;
  let   yPos       = margin;

  // ── Full-page black background ────────────────────────────────────────
  const fillBlack = () => {
    pdf.setFillColor(...C.black);
    pdf.rect(0, 0, pageWidth, pageHeight, 'F');
  };
  fillBlack();

  // ── Text helper ──────────────────────────────────────────────────────
  const t = (str, x, y, opts = {}) => {
    pdf.setFontSize(opts.size || 8);
    pdf.setFont('helvetica', opts.bold ? 'bold' : 'normal');
    pdf.setTextColor(...(opts.color || C.white));
    pdf.text(String(str ?? ''), x, y, { align: opts.align || 'left' });
  };

  const termsConditions = quotation.termsConditions || {};
  const selectedTermIds = new Set(termsConditions.selected || []);
  const selectedTerms = DEFAULT_QUOTATION_TERMS.flatMap((term, index) => {
    const terms = [];
    if (index === 5 && selectedTermIds.has('paymentTerms') && termsConditions.paymentTerms?.trim()) {
      terms.push({ number: 6, text: `Payment Terms:\n${termsConditions.paymentTerms.trim()}` });
    }
    if (selectedTermIds.has(term.id)) {
      terms.push({ number: index < 5 ? index + 1 : index + 2, text: term.text });
    }
    return terms;
  });

  const checkPage = (needed = ROW_H + 4) => {
    if (yPos + needed > pageHeight - 18) {
      pdf.addPage();
      fillBlack();
      yPos = margin;
      return true;
    }
    return false;
  };

  // ── Pre-load logo ─────────────────────────────────────────────────────
  const logoData = await assetToBase64(Mahavirlogo);

  // ── Pre-load all product images ───────────────────────────────────────
  const imageCache = {};
  for (const qp of quotation.products) {
    const imgPath = qp.productDetails?.img;
    if (imgPath && !imageCache[imgPath]) {
      imageCache[imgPath] = await imageUrlToBase64(`${BACKEND_URL}${imgPath}`);
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  // ── HEADER ────────────────────────────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════════
  const HEADER_H = 28;
  pdf.setFillColor(...C.blackSoft);
  pdf.rect(0, 0, pageWidth, HEADER_H, 'F');

  // Gold bottom border
  pdf.setDrawColor(...C.gold);
  pdf.setLineWidth(0.6);
  pdf.line(0, HEADER_H, pageWidth, HEADER_H);

  // Logo
  if (logoData) {
    try { pdf.addImage(logoData, 'PNG', margin, 3, 22, 22); } catch { /* skip */ }
  }

  // Company name & subtitle
  const hTextX = margin + 26;
  t('Mahaveer Hospitality', hTextX, 13, { size: 15, bold: true, color: C.gold });
  t('Product Quotation', hTextX, 20, { size: 8, color: C.greyLight });

  yPos = HEADER_H + 7;

  // ── Quotation number + date ───────────────────────────────────────────
  t('QUOTATION', margin, yPos, { size: 13, bold: true, color: C.gold });
  yPos += 5;
  t(`No: ${quotation.quotationNumber || quotation.q_id}`, margin, yPos, { size: 9, bold: true, color: C.white });
  t(`Date: ${new Date(quotation.date || quotation.createdAt).toLocaleDateString('en-IN')}`, pageWidth - margin, yPos, { size: 9, color: C.greyLight, align: 'right' });
  yPos += 4;
  pdf.setDrawColor(...C.goldMuted);
  pdf.setLineWidth(0.3);
  pdf.line(margin, yPos, pageWidth - margin, yPos);
  yPos += 5;

  // ══════════════════════════════════════════════════════════════════════
  // ── CLIENT + SELLER DETAILS ───────────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════════
  const halfW = (usable - 6) / 2;

  // Capture header Y so both boxes start on the exact same line
  const headerBoxY = yPos;

  // Client header
  pdf.setFillColor(...C.blackRow);
  pdf.rect(margin, headerBoxY, halfW, 6, 'F');
  pdf.setDrawColor(...C.goldMuted);
  pdf.setLineWidth(0.2);
  pdf.rect(margin, headerBoxY, halfW, 6, 'S');
  t('CLIENT DETAILS', margin + 2, headerBoxY + 4.5, { size: 8, bold: true, color: C.gold });
  yPos = headerBoxY + 10;

  const clientTop = yPos;
  t(`Name    : ${quotation.clientName}`,                        margin + 2, yPos, { size: 8, color: C.greyLight }); yPos += 4.5;
  t(`Firm    : ${quotation.firmName}`,                          margin + 2, yPos, { size: 8, color: C.greyLight }); yPos += 4.5;
  t(`Contact : ${quotation.contact || quotation.mobile || ''}`, margin + 2, yPos, { size: 8, color: C.greyLight }); yPos += 4.5;
  if (quotation.email)     { t(`Email   : ${quotation.email}`,     margin + 2, yPos, { size: 8, color: C.greyLight }); yPos += 4.5; }
  if (quotation.address)   { t(`Address : ${quotation.address}`,   margin + 2, yPos, { size: 8, color: C.greyLight }); yPos += 4.5; }
  if (quotation.gstNumber) { t(`GST No  : ${quotation.gstNumber}`, margin + 2, yPos, { size: 8, color: C.greyLight }); yPos += 4.5; }
  const clientBottom = yPos;

  // Seller section — starts at exactly the same Y as client header
  const selX = margin + halfW + 6;
  let sY = headerBoxY;
  pdf.setFillColor(...C.blackRow);
  pdf.rect(selX, sY, halfW, 6, 'F');
  pdf.setDrawColor(...C.goldMuted);
  pdf.setLineWidth(0.2);
  pdf.rect(selX, sY, halfW, 6, 'S');
  t('SELLER DETAILS', selX + 2, sY + 4.5, { size: 8, bold: true, color: C.gold });
  sY += 10;
  t('Company    : Mahaveer Hospitality',          selX + 2, sY, { size: 8, color: C.greyLight }); sY += 4.5;
  t(`Created By : ${quotation.createdBy || ''}`,  selX + 2, sY, { size: 8, color: C.greyLight });

  yPos = Math.max(clientBottom, sY) + 12;

  // ══════════════════════════════════════════════════════════════════════
  // ── TABLE ─────────────────────────────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════════
  const IMG_W = 14;
  const COL_DEF = [
    { key: 'img',          label: '',        width: IMG_W },
    { key: 'product',      label: 'Product', width: 38 },
    { key: 'size',         label: 'Size',    width: 16 },
    { key: 'innerPack',    label: 'Inner',   width: 13 },
    { key: 'masterCarton', label: 'M.Ctn',   width: 14 },
    { key: 'quantity',     label: 'Qty',     width: 11 },
    { key: 'totalPieces',  label: 'Tot Pcs', width: 14 },
    { key: 'mrp',          label: 'MRP',     width: 18 },
    { key: 'discount',     label: 'Disc%',   width: 13 },
    { key: 'finalPrice',   label: 'Price',   width: 18 },
    { key: 'gst',          label: 'GST%',    width: 12 },
    { key: 'total',        label: 'Total',   width: 19 },
  ];

  const activeCols = COL_DEF.filter((c) =>
    c.key === 'img' ? true : selectedColumns[c.key]
  );
  const rawTotal = activeCols.reduce((s, c) => s + c.width, 0);
  const scale    = usable / rawTotal;
  activeCols.forEach((c) => { c.width = c.width * scale; });

  const ROW_H_IMG = 18;

  const drawHeader = () => {
    pdf.setFillColor(...C.blackRow);
    pdf.rect(margin, yPos, usable, 8, 'F');
    // Gold bottom border on header
    pdf.setDrawColor(...C.gold);
    pdf.setLineWidth(0.4);
    pdf.line(margin, yPos + 8, margin + usable, yPos + 8);

    let x = margin + 1;
    activeCols.forEach((col) => {
      if (col.key !== 'img') {
        t(col.label, x, yPos + 5.5, { size: 7, bold: true, color: C.gold });
      }
      x += col.width;
    });
    yPos += 8;
  };

  drawHeader();

  // ── Table rows ────────────────────────────────────────────────────────
  quotation.products.forEach((qp, idx) => {
    const details   = qp.productDetails || {};
    const hasImg    = !!(details.img && imageCache[details.img]);
    const rowHeight = hasImg ? ROW_H_IMG : ROW_H;

    const added = checkPage(rowHeight + 2);
    if (added) drawHeader();

    const totalPcs  = (qp.innerPack || 0) * (qp.quatity || qp.quantity || 0);
    const masterCtn = qp.masterPack
      ? ((1 / (qp.masterPack / (qp.innerPack || 1))) * (qp.quatity || qp.quantity || 0)).toFixed(2)
      : '—';
    const itemSub   = totalPcs * (qp.finalPrice || 0);
    const gstPct    = qp.gstPercentage ?? details.gstPercentage ?? details.gstPercent ?? 0;
    const itemTotal = itemSub + (itemSub * gstPct) / 100;

    // Alternating row bg
    if (idx % 2 === 0) {
      pdf.setFillColor(...C.blackCard);
    } else {
      pdf.setFillColor(22, 22, 22);
    }
    pdf.rect(margin, yPos, usable, rowHeight, 'F');
    pdf.setDrawColor(40, 40, 40);
    pdf.setLineWidth(0.1);
    pdf.rect(margin, yPos, usable, rowHeight, 'S');

    let x    = margin + 1;
    const mid = yPos + rowHeight / 2 + 1.5;
    const top = yPos + 5;
    const bot = yPos + 10;

    activeCols.forEach((col) => {
      switch (col.key) {
        case 'img': {
          if (hasImg) {
            const imgData = imageCache[details.img];
            const ext     = details.img.split('.').pop().toLowerCase();
            const fmt     = ext === 'png' ? 'PNG' : 'JPEG';
            try {
              pdf.addImage(imgData, fmt, x + 1, yPos + 1, col.width - 2, rowHeight - 2);
            } catch { /* skip */ }
          }
          break;
        }
        case 'product':
          t(qp.productName || details.name || 'Product unavailable', x, top, { size: 7, bold: true, color: C.white });
          t(`HSN: ${details.hsnCode || '—'}`,      x, bot, { size: 6, color: C.greyMid });
          if (details.material) {
            t(`Mat: ${details.material}`,           x, bot + 4, { size: 6, color: C.greyMid });
          }
          break;
        case 'size':         t(qp.size || '—',                        x, mid, { size: 8, color: C.greyLight }); break;
        case 'innerPack':    t(String(qp.innerPack || 0),              x, mid, { size: 8, color: C.greyLight }); break;
        case 'masterCarton': t(masterCtn,                              x, mid, { size: 8, color: C.greyLight }); break;
        case 'quantity':     t(String(qp.quatity || qp.quantity || 0), x, mid, { size: 8, color: C.greyLight }); break;
        case 'totalPieces':  t(String(totalPcs),                       x, mid, { size: 8, color: C.greyLight }); break;
        case 'mrp':          t(`${(qp.mrp || 0).toFixed(2)}`,          x, mid, { size: 8, color: C.greyLight }); break;
        case 'discount':     t(`${qp.discount ?? 0}%`,                 x, mid, { size: 8, color: C.greyLight }); break;
        case 'finalPrice':   t(`${(qp.finalPrice || 0).toFixed(2)}`,   x, mid, { size: 8, color: C.white });     break;
        case 'gst':          t(`${gstPct}%`,                           x, mid, { size: 8, color: C.greyLight }); break;
        case 'total':        t(`${itemTotal.toFixed(2)}`,              x, mid, { size: 8, bold: true, color: C.gold }); break;
      }
      x += col.width;
    });

    yPos += rowHeight;
  });

  yPos += 6;
  checkPage(36);

  // ══════════════════════════════════════════════════════════════════════
  // ── TOTALS ────────────────────────────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════════
  const totW = 70;
  const totX = pageWidth - margin - totW;

  // Subtotal row
  pdf.setFillColor(...C.blackRow);
  pdf.setDrawColor(40, 40, 40);
  pdf.rect(totX, yPos, totW, 7, 'F');
  pdf.rect(totX, yPos, totW, 7, 'S');
  t('Subtotal (excl. GST)', totX + 2, yPos + 5, { size: 8, color: C.greyLight });
  t(`${(quotation.subtotal || quotation.Subtotal || 0).toFixed(2)}`, totX + totW - 2, yPos + 5, { size: 8, bold: true, color: C.white, align: 'right' });
  yPos += 7;

  // GST row
  pdf.setFillColor(...C.blackRow);
  pdf.rect(totX, yPos, totW, 7, 'F');
  pdf.rect(totX, yPos, totW, 7, 'S');
  t('GST Amount', totX + 2, yPos + 5, { size: 8, color: C.greyLight });
  t(`${(quotation.gstAmount || quotation.gstamount || 0).toFixed(2)}`, totX + totW - 2, yPos + 5, { size: 8, bold: true, color: C.white, align: 'right' });
  yPos += 7;

  // Grand total row — gold highlight
  pdf.setFillColor(...C.blackSoft);
  pdf.rect(totX, yPos, totW, 9, 'F');
  pdf.setDrawColor(...C.gold);
  pdf.setLineWidth(0.4);
  pdf.rect(totX, yPos, totW, 9, 'S');
  // Gold left accent
  pdf.setFillColor(...C.gold);
  pdf.rect(totX, yPos, 2, 9, 'F');
  t('GRAND TOTAL', totX + 4, yPos + 6.5, { size: 9, bold: true, color: C.gold });
  t(`${(quotation.grandTotal || quotation.grandtotal || 0).toFixed(2)}`, totX + totW - 2, yPos + 6.5, { size: 9, bold: true, color: C.gold, align: 'right' });
  yPos += 16;

  if (selectedTerms.length > 0) {
    checkPage(14);
    t('TERMS AND CONDITIONS', margin, yPos, { size: 9, bold: true, color: C.gold });
    yPos += 6;
    selectedTerms.forEach((term) => {
      pdf.setFontSize(7);
      pdf.setFont('helvetica', 'normal');
      // Split each manually entered line separately so Enter in payment terms
      // is retained in the generated quotation PDF.
      const lines = String(`${term.number}. ${term.text}`)
        .split(/\r?\n/)
        .flatMap((line) => pdf.splitTextToSize(line || ' ', usable - 4));
      const blockHeight = lines.length * 4;
      checkPage(blockHeight + 2);
      lines.forEach((line) => {
        t(line, margin + 2, yPos, { size: 7, color: C.greyLight });
        yPos += 4;
      });
      yPos += 1;
    });
    yPos += 2;
  }

  // ── Signature ─────────────────────────────────────────────────────────
  checkPage(16);
  const sigX = pageWidth - margin - 55;
  pdf.setDrawColor(...C.goldMuted);
  pdf.setLineWidth(0.3);
  pdf.line(sigX, yPos, pageWidth - margin, yPos);
  yPos += 4;
  t('Authorized Signature', sigX + 3, yPos, { size: 7, color: C.greyDark });

  // ── Footer ────────────────────────────────────────────────────────────
  const fY = pageHeight - 10;
  pdf.setDrawColor(...C.goldMuted);
  pdf.setLineWidth(0.3);
  pdf.line(margin, fY - 4, pageWidth - margin, fY - 4);
  t('Thank you for your business!', pageWidth / 2, fY - 1, { size: 8, color: C.greyMid, align: 'center' });
  t('Mahaveer Hospitality — Bill Quotation & Catalog System', pageWidth / 2, fY + 3, { size: 7, color: C.greyDark, align: 'center' });

  // ── Output ────────────────────────────────────────────────────────────
  if (mode === 'download') {
    pdf.save(`Quotation_${quotation.quotationNumber || quotation.q_id}.pdf`);
  } else {
    return pdf.output('blob');
  }
}

// ── Base64 export for WhatsApp backend sending ────────────────────────────
export async function generateQuotationPDFAsBase64(quotation, selectedColumns) {
  const blob = await generateQuotationPDF(quotation, selectedColumns, 'blob');
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result.split(',')[1]);
    reader.onerror  = reject;
    reader.readAsDataURL(blob);
  });
}
