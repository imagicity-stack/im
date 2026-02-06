import jsPDF from 'jspdf';

const formatMoney = (value) => `₹${Number(value || 0).toFixed(2)}`;

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

export const generateInvoicePDF = async (invoice, client, settings) => {
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  const logoDataUrl = await loadLogoDataUrl();
  const companyName = settings?.company_name || 'IMAGICITY';

  doc.setFillColor(17, 24, 39);
  doc.rect(0, 0, pageWidth, 34, 'F');

  if (logoDataUrl) {
    try {
      doc.addImage(logoDataUrl, 'PNG', 15, 8, 42, 16);
    } catch {
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(18);
      doc.setFont('helvetica', 'bold');
      doc.text(companyName, 15, 20);
    }
  } else {
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(18);
    doc.setFont('helvetica', 'bold');
    doc.text(companyName, 15, 20);
  }

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.text((invoice?.invoice_type || 'INVOICE').toUpperCase(), pageWidth - 15, 15, { align: 'right' });
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text(invoice?.invoice_number || 'INV-0000', pageWidth - 15, 22, { align: 'right' });

  doc.setTextColor(31, 41, 55);
  doc.setFontSize(10);

  let y = 46;
  doc.setFont('helvetica', 'bold');
  doc.text('BILLED BY', 15, y);
  doc.text('BILLED TO', pageWidth - 15, y, { align: 'right' });

  y += 6;
  doc.setFont('helvetica', 'normal');
  const left = [
    companyName,
    `GSTIN: ${settings?.company_gstin || 'N/A'}`,
    settings?.company_address || 'N/A',
  ];
  const right = [
    client?.business_name || client?.name || 'N/A',
    client?.gstin ? `GSTIN: ${client.gstin}` : null,
    client?.email || null,
    client?.phone || null,
  ].filter(Boolean);

  left.forEach((line, i) => doc.text(line, 15, y + i * 5, { maxWidth: 85 }));
  right.forEach((line, i) => doc.text(line, pageWidth - 15, y + i * 5, { align: 'right', maxWidth: 85 }));

  y += 22;
  doc.setDrawColor(229, 231, 235);
  doc.line(15, y, pageWidth - 15, y);
  y += 7;

  doc.setFont('helvetica', 'bold');
  doc.text(`Invoice Date: ${invoice?.invoice_date || 'N/A'}`, 15, y);
  doc.text(`Due Date: ${invoice?.due_date || 'N/A'}`, pageWidth - 15, y, { align: 'right' });

  y += 10;
  doc.setFillColor(243, 244, 246);
  doc.rect(15, y - 5, pageWidth - 30, 9, 'F');
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.text('#', 18, y);
  doc.text('Description', 26, y);
  doc.text('Qty', 120, y);
  doc.text('Rate', 145, y);
  doc.text('Amount', 175, y);

  y += 7;
  doc.setFont('helvetica', 'normal');

  const items = Array.isArray(invoice?.items) ? invoice.items : [];
  if (!items.length) {
    doc.text('No line items', 26, y);
    y += 8;
  } else {
    items.forEach((item, index) => {
      if (y > pageHeight - 70) {
        doc.addPage();
        y = 20;
      }
      doc.text(String(index + 1), 18, y);
      doc.text(item.description || '-', 26, y, { maxWidth: 86 });
      doc.text(String(item.quantity || 0), 120, y);
      doc.text(formatMoney(item.rate), 145, y);
      doc.text(formatMoney(item.amount), 175, y);
      y += 7;
    });
  }

  doc.line(15, y, pageWidth - 15, y);
  y += 9;

  const rightX = pageWidth - 15;
  const labelX = rightX - 58;
  doc.text('Subtotal', labelX, y);
  doc.text(formatMoney(invoice?.subtotal), rightX, y, { align: 'right' });
  y += 6;
  doc.text('IGST', labelX, y);
  doc.text(formatMoney(invoice?.igst), rightX, y, { align: 'right' });
  y += 7;

  doc.setFillColor(249, 250, 251);
  doc.rect(labelX - 4, y - 5, 62, 10, 'F');
  doc.setFont('helvetica', 'bold');
  doc.text('Total', labelX, y + 1);
  doc.text(formatMoney(invoice?.total), rightX, y + 1, { align: 'right' });

  y += 14;
  if (invoice?.notes) {
    doc.setFont('helvetica', 'bold');
    doc.text('Notes', 15, y);
    y += 5;
    doc.setFont('helvetica', 'normal');
    doc.text(invoice.notes, 15, y, { maxWidth: pageWidth - 30 });
    y += 10;
  }

  if (y > pageHeight - 50) {
    doc.addPage();
    y = 20;
  }

  doc.setFillColor(250, 250, 250);
  doc.rect(15, y, pageWidth - 30, 24, 'F');
  doc.setDrawColor(209, 213, 219);
  doc.rect(15, y, pageWidth - 30, 24);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.text('PAYMENT DETAILS', 18, y + 6);
  doc.setFont('helvetica', 'normal');
  doc.text(`Bank: ${settings?.bank_name || 'N/A'}`, 18, y + 11);
  doc.text(`Account: ${settings?.account_number || 'N/A'}`, 18, y + 16);
  doc.text(`IFSC: ${settings?.ifsc_code || 'N/A'}   UPI: ${settings?.upi_id || 'N/A'}`, 18, y + 21);

  doc.setFontSize(8);
  doc.setTextColor(107, 114, 128);
  doc.text('Thank you for your business', pageWidth / 2, pageHeight - 8, { align: 'center' });

  return doc;
};
