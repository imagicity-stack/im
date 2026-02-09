import jsPDF from 'jspdf';

const formatMoney = (value) => `₹${Number(value || 0).toFixed(2)}`;

const FONT_REGULAR_URL = 'https://raw.githubusercontent.com/googlefonts/noto-fonts/main/hinted/ttf/NotoSans/NotoSans-Regular.ttf';
const FONT_BOLD_URL = 'https://raw.githubusercontent.com/googlefonts/noto-fonts/main/hinted/ttf/NotoSans/NotoSans-Bold.ttf';

let cachedFontRegular;
let cachedFontBold;

const arrayBufferToBase64 = (buffer) => {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
};

const loadFontBase64 = async (url, cached) => {
  if (cached.value) return cached.value;
  const response = await fetch(url);
  if (!response.ok) return '';
  const buffer = await response.arrayBuffer();
  cached.value = arrayBufferToBase64(buffer);
  return cached.value;
};

const loadFonts = async (doc) => {
  try {
    const regularCache = { get value() { return cachedFontRegular; }, set value(v) { cachedFontRegular = v; } };
    const boldCache = { get value() { return cachedFontBold; }, set value(v) { cachedFontBold = v; } };
    const [regular, bold] = await Promise.all([
      loadFontBase64(FONT_REGULAR_URL, regularCache),
      loadFontBase64(FONT_BOLD_URL, boldCache),
    ]);

    if (regular) {
      doc.addFileToVFS('NotoSans-Regular.ttf', regular);
      doc.addFont('NotoSans-Regular.ttf', 'NotoSans', 'normal');
    }
    if (bold) {
      doc.addFileToVFS('NotoSans-Bold.ttf', bold);
      doc.addFont('NotoSans-Bold.ttf', 'NotoSans', 'bold');
    }

    return Boolean(regular);
  } catch {
    return false;
  }
};

const loadLogoDataUrl = async () => {
  try {
    const response = await fetch('/imagicity-logo.png');
    if (!response.ok) return null;
    const blob = await response.blob();
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
};
const numberToWords = (value) => {
  const ones = [
    'Zero',
    'One',
    'Two',
    'Three',
    'Four',
    'Five',
    'Six',
    'Seven',
    'Eight',
    'Nine',
    'Ten',
    'Eleven',
    'Twelve',
    'Thirteen',
    'Fourteen',
    'Fifteen',
    'Sixteen',
    'Seventeen',
    'Eighteen',
    'Nineteen',
  ];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

  const twoDigits = (num) => {
    if (num < 20) return ones[num];
    const ten = Math.floor(num / 10);
    const rest = num % 10;
    return `${tens[ten]}${rest ? ` ${ones[rest]}` : ''}`;
  };

  const threeDigits = (num) => {
    if (num < 100) return twoDigits(num);
    const hundred = Math.floor(num / 100);
    const rest = num % 100;
    return `${ones[hundred]} Hundred${rest ? ` ${twoDigits(rest)}` : ''}`;
  };

  if (value === 0) return 'Zero';

  const units = [
    { value: 10000000, label: 'Crore' },
    { value: 100000, label: 'Lakh' },
    { value: 1000, label: 'Thousand' },
  ];

  let num = value;
  const parts = [];

  units.forEach((unit) => {
    if (num >= unit.value) {
      const unitCount = Math.floor(num / unit.value);
      parts.push(`${unitCount >= 100 ? threeDigits(unitCount) : twoDigits(unitCount)} ${unit.label}`);
      num %= unit.value;
    }
  });

  if (num > 0) {
    parts.push(num >= 100 ? threeDigits(num) : twoDigits(num));
  }

  return parts.join(' ');
};

const formatAmountInWords = (amount) => {
  const value = Number(amount || 0);
  const rupees = Math.floor(value);
  const paise = Math.round((value - rupees) * 100);
  const rupeesText = `${numberToWords(rupees)} Rupees`;
  const paiseText = paise ? ` and ${numberToWords(paise)} Paise` : '';
  return `${rupeesText}${paiseText} Only`;
};

const ensurePageSpace = (doc, y, minSpace, marginY = 20) => {
  const pageHeight = doc.internal.pageSize.getHeight();
  if (y + minSpace > pageHeight - marginY) {
    doc.addPage();
    return marginY;
  }
  return y;
};

const buildInvoicePDF = async (invoice, client, settings, config) => {
  const doc = new jsPDF();
  const hasCustomFont = await loadFonts(doc);
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  const logoDataUrl = await loadLogoDataUrl();
  doc.setFont(hasCustomFont ? 'NotoSans' : 'helvetica', 'normal');
  const companyName = settings?.company_name || 'IMAGICITY';
  const companyGstin = settings?.company_gstin || 'N/A';
  const companyAddress = settings?.company_address || 'N/A';

  const invoiceNumber = invoice?.invoice_number || 'INV-0000';
  const invoiceDate = invoice?.invoice_date || 'N/A';
  const dueDate = invoice?.due_date || 'N/A';
  const validFrom = invoice?.valid_from || invoiceDate;
  const validTill = invoice?.valid_till || dueDate;

  const items = Array.isArray(invoice?.items) ? invoice.items : [];

  const marginX = 15;

  if (logoDataUrl) {
    try {
      doc.addImage(logoDataUrl, 'PNG', marginX, 8, 40, 14);
    } catch {
      doc.setTextColor(0, 0, 0);
      doc.setFontSize(18);
      doc.setFont(hasCustomFont ? 'NotoSans' : 'helvetica', 'bold');
      doc.text(companyName, marginX, 18);
    }
  } else {
    doc.setTextColor(0, 0, 0);
    doc.setFontSize(18);
    doc.setFont(hasCustomFont ? 'NotoSans' : 'helvetica', 'bold');
    doc.text(companyName, marginX, 18);
  }

  doc.setDrawColor(220, 38, 38);
  doc.setLineWidth(2);
  doc.line(marginX, 28, pageWidth - marginX, 28);

  doc.setTextColor(220, 38, 38);
  doc.setFontSize(11);
  doc.setFont(hasCustomFont ? 'NotoSans' : 'helvetica', 'bold');
  doc.text(config.title, marginX, 38);
  doc.text(invoiceNumber, pageWidth - marginX, 38, { align: 'right' });

  doc.setTextColor(0, 0, 0);
  doc.setFontSize(9);
  doc.setFont(hasCustomFont ? 'NotoSans' : 'helvetica', 'bold');
  doc.text('FROM:', marginX, 48);
  doc.text('BILL TO:', pageWidth - marginX, 48, { align: 'right' });

  doc.setFont(hasCustomFont ? 'NotoSans' : 'helvetica', 'bold');
  doc.text(companyName, marginX, 54);
  doc.text(client?.business_name || client?.name || 'N/A', pageWidth - marginX, 54, { align: 'right' });

  doc.setFont(hasCustomFont ? 'NotoSans' : 'helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.text(`GSTIN: ${companyGstin}`, marginX, 60);
  if (client?.gstin) {
    doc.text(`GSTIN: ${client.gstin}`, pageWidth - marginX, 60, { align: 'right' });
  }

  const addressLines = doc.splitTextToSize(companyAddress, 85);
  addressLines.forEach((line, index) => {
    doc.text(line, marginX, 66 + index * 4);
  });

  let billToY = 66;
  if (client?.email) {
    doc.text(client.email, pageWidth - marginX, billToY, { align: 'right' });
    billToY += 4;
  }
  if (client?.phone) {
    doc.text(client.phone, pageWidth - marginX, billToY, { align: 'right' });
  }

  let dateY = Math.max(78, 66 + addressLines.length * 4 + 6);
  doc.setFontSize(8.5);
  doc.setFont(hasCustomFont ? 'NotoSans' : 'helvetica', 'normal');
  const leftDateLabel = config.dateLabels?.left || 'Invoice Date';
  const rightDateLabel = config.dateLabels?.right || 'Due Date';
  const leftDateValue = config.dateValues?.left === 'valid_from' ? validFrom : invoiceDate;
  const rightDateValue = config.dateValues?.right === 'valid_till' ? validTill : dueDate;
  doc.text(`${leftDateLabel}: ${leftDateValue}`, marginX, dateY);
  doc.text(`${rightDateLabel}: ${rightDateValue}`, pageWidth - marginX, dateY, { align: 'right' });

  let tableY = dateY + 10;

  doc.setFillColor(245, 158, 11);
  doc.rect(marginX, tableY, pageWidth - marginX * 2, 7, 'F');
  doc.setTextColor(0, 0, 0);
  doc.setFontSize(8.5);
  doc.setFont(hasCustomFont ? 'NotoSans' : 'helvetica', 'bold');
  doc.text('DESCRIPTION', marginX + 4, tableY + 5);
  doc.text('QTY', marginX + 110, tableY + 5, { align: 'center' });
  doc.text('RATE', marginX + 138, tableY + 5, { align: 'right' });
  doc.text('AMOUNT', pageWidth - marginX - 4, tableY + 5, { align: 'right' });

  doc.setFont(hasCustomFont ? 'NotoSans' : 'helvetica', 'normal');
  let rowY = tableY + 12;
  if (!items.length) {
    doc.text('No line items', marginX + 4, rowY);
    rowY += 6;
  } else {
    items.forEach((item) => {
      if (rowY > pageHeight - 70) {
        doc.addPage();
        rowY = 20;
      }
      doc.text(item.description || '-', marginX + 4, rowY, { maxWidth: 90 });
      doc.text(String(item.quantity || 0), marginX + 110, rowY, { align: 'center' });
      doc.text(formatMoney(item.rate), marginX + 138, rowY, { align: 'right' });
      doc.text(formatMoney(item.amount), pageWidth - marginX - 4, rowY, { align: 'right' });
      rowY += 6;
    });
  }

  doc.setDrawColor(220, 38, 38);
  doc.setLineWidth(1.5);
  doc.line(marginX, rowY + 2, pageWidth - marginX, rowY + 2);

  const totalsY = rowY + 10;
  doc.setTextColor(0, 0, 0);
  doc.setFontSize(8.5);
  doc.text('Subtotal:', pageWidth - marginX - 50, totalsY);
  doc.text(formatMoney(invoice?.subtotal), pageWidth - marginX, totalsY, { align: 'right' });

  doc.text('IGST (18%):', pageWidth - marginX - 50, totalsY + 6);
  doc.text(formatMoney(invoice?.igst), pageWidth - marginX, totalsY + 6, { align: 'right' });

  doc.setFillColor(245, 158, 11);
  doc.rect(pageWidth - marginX - 80, totalsY + 11, 80, 8, 'F');
  doc.setFont(hasCustomFont ? 'NotoSans' : 'helvetica', 'bold');
  doc.text('TOTAL:', pageWidth - marginX - 76, totalsY + 17);
  doc.text(formatMoney(invoice?.total), pageWidth - marginX - 6, totalsY + 17, { align: 'right' });

  let sectionY = totalsY + 28;
  const amountPaid = Number(invoice?.amount_paid || 0);
  const totalDue = Math.max(Number(invoice?.total || 0) - amountPaid, 0);

  if (config.showAmountInWords) {
    sectionY = ensurePageSpace(doc, sectionY, 20);
    doc.setFont(hasCustomFont ? 'NotoSans' : 'helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(0, 0, 0);
    doc.text('AMOUNT IN WORDS', marginX, sectionY);
    doc.setFont(hasCustomFont ? 'NotoSans' : 'helvetica', 'normal');
    doc.setFontSize(8.5);
    const words = doc.splitTextToSize(formatAmountInWords(invoice?.total), pageWidth - marginX * 2);
    doc.text(words, marginX, sectionY + 5);
    sectionY += 12 + words.length * 4;
  }

  if (config.showPaymentSummary) {
    sectionY = ensurePageSpace(doc, sectionY, 22);
    if (config.showPaymentSummaryBlock) {
      doc.setDrawColor(209, 213, 219);
      doc.setFillColor(249, 250, 251);
      doc.rect(marginX, sectionY - 3, pageWidth - marginX * 2, 18, 'FD');
    }
    doc.setFont(hasCustomFont ? 'NotoSans' : 'helvetica', 'bold');
    doc.setFontSize(9);
    doc.text('PAYMENT SUMMARY', marginX + 2, sectionY + 2);
    doc.setFont(hasCustomFont ? 'NotoSans' : 'helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.text(`Amount Paid: ${formatMoney(amountPaid)}`, marginX + 2, sectionY + 8);
    doc.text(`Total Dues: ${config.showNoDues ? 'No dues' : formatMoney(totalDue)}`, marginX + 2, sectionY + 13);
    sectionY += 22;
  }

  if (config.showTerms) {
    sectionY = ensurePageSpace(doc, sectionY, 16);
    doc.setFont(hasCustomFont ? 'NotoSans' : 'helvetica', 'bold');
    doc.setFontSize(9);
    doc.text('TERMS', marginX, sectionY);
    doc.setFont(hasCustomFont ? 'NotoSans' : 'helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.text('60% advance and 40% post completion.', marginX, sectionY + 6);
    sectionY += 14;
  }

  if (config.showEstimateNote) {
    sectionY = ensurePageSpace(doc, sectionY, 12);
    doc.setFont(hasCustomFont ? 'NotoSans' : 'helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(185, 28, 28);
    doc.text('This is an estimate and not the final invoice.', marginX, sectionY + 2);
    doc.setTextColor(0, 0, 0);
    sectionY += 10;
  }

  const paymentY = ensurePageSpace(doc, sectionY + 4, 26);
  doc.setFont(hasCustomFont ? 'NotoSans' : 'helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(0, 0, 0);
  doc.text('PAYMENT DETAILS', marginX, paymentY);

  doc.setFont(hasCustomFont ? 'NotoSans' : 'helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.text(`Bank: ${settings?.bank_name || 'N/A'}`, marginX, paymentY + 6);
  doc.text(`Account: ${settings?.account_number || 'N/A'}`, marginX, paymentY + 11);
  doc.text(`IFSC: ${settings?.ifsc_code || 'N/A'}`, marginX, paymentY + 16);
  doc.text(`UPI: ${settings?.upi_id || 'N/A'}`, marginX, paymentY + 21);

  doc.setFontSize(8);
  doc.setTextColor(107, 114, 128);
  doc.text('Thank you for your business!', pageWidth / 2, pageHeight - 12, { align: 'center' });
  doc.text(companyName, pageWidth / 2, pageHeight - 7, { align: 'center' });

  return doc;
};

const PDF_CONFIGS = {
  invoice: {
    title: 'INVOICE',
    showAmountInWords: true,
    showPaymentSummary: true,
    showTerms: true,
    showNoDues: false,
    showPaymentSummaryBlock: true,
  },
  proforma: {
    title: 'PROFORMA',
    showAmountInWords: true,
    showPaymentSummary: false,
    showTerms: true,
    showNoDues: false,
    showEstimateNote: true,
    dateLabels: { left: 'Valid From', right: 'Valid Till' },
    dateValues: { left: 'valid_from', right: 'valid_till' },
  },
  quotation: {
    title: 'QUOTATION',
    showAmountInWords: false,
    showPaymentSummary: false,
    showTerms: false,
    showNoDues: false,
  },
  sale_receipt: {
    title: 'SALE RECEIPT',
    showAmountInWords: true,
    showPaymentSummary: true,
    showTerms: false,
    showNoDues: true,
    showPaymentSummaryBlock: true,
  },
};

export const generateInvoicePDF = async (invoice, client, settings) => {
  return buildInvoicePDF(invoice, client, settings, PDF_CONFIGS.invoice);
};

export const generateProformaPDF = async (invoice, client, settings) => {
  return buildInvoicePDF(invoice, client, settings, PDF_CONFIGS.proforma);
};

export const generateSaleReceiptPDF = async (invoice, client, settings) => {
  return buildInvoicePDF(invoice, client, settings, PDF_CONFIGS.sale_receipt);
};

export const generatePdfForInvoice = async (invoice, client, settings) => {
  const type = invoice?.invoice_type || 'invoice';
  const config = PDF_CONFIGS[type] || PDF_CONFIGS.invoice;
  return buildInvoicePDF(invoice, client, settings, config);
};
