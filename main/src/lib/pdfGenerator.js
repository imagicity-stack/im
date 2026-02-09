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
  const companyGstin = settings?.company_gstin || 'N/A';
  const companyAddress = settings?.company_address || 'N/A';

  const invoiceNumber = invoice?.invoice_number || 'INV-0000';
  const invoiceDate = invoice?.invoice_date || 'N/A';
  const dueDate = invoice?.due_date || 'N/A';

  const items = Array.isArray(invoice?.items) ? invoice.items : [];

  const marginX = 15;

  if (logoDataUrl) {
    try {
      doc.addImage(logoDataUrl, 'PNG', marginX, 8, 40, 14);
    } catch {
      doc.setTextColor(0, 0, 0);
      doc.setFontSize(18);
      doc.setFont('helvetica', 'bold');
      doc.text(companyName, marginX, 18);
    }
  } else {
    doc.setTextColor(0, 0, 0);
    doc.setFontSize(18);
    doc.setFont('helvetica', 'bold');
    doc.text(companyName, marginX, 18);
  }

  doc.setDrawColor(220, 38, 38);
  doc.setLineWidth(2);
  doc.line(marginX, 28, pageWidth - marginX, 28);

  doc.setTextColor(220, 38, 38);
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.text('INVOICE', marginX, 38);
  doc.text(invoiceNumber, pageWidth - marginX, 38, { align: 'right' });

  doc.setTextColor(0, 0, 0);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.text('FROM:', marginX, 48);
  doc.text('BILL TO:', pageWidth - marginX, 48, { align: 'right' });

  doc.setFont('helvetica', 'bold');
  doc.text(companyName, marginX, 54);
  doc.text(client?.business_name || client?.name || 'N/A', pageWidth - marginX, 54, { align: 'right' });

  doc.setFont('helvetica', 'normal');
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
  doc.setFont('helvetica', 'normal');
  doc.text(`Invoice Date: ${invoiceDate}`, marginX, dateY);
  doc.text(`Due Date: ${dueDate}`, pageWidth - marginX, dateY, { align: 'right' });

  let tableY = dateY + 10;

  doc.setFillColor(245, 158, 11);
  doc.rect(marginX, tableY, pageWidth - marginX * 2, 7, 'F');
  doc.setTextColor(0, 0, 0);
  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'bold');
  doc.text('DESCRIPTION', marginX + 4, tableY + 5);
  doc.text('QTY', marginX + 110, tableY + 5, { align: 'center' });
  doc.text('RATE', marginX + 138, tableY + 5, { align: 'right' });
  doc.text('AMOUNT', pageWidth - marginX - 4, tableY + 5, { align: 'right' });

  doc.setFont('helvetica', 'normal');
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
  doc.rect(pageWidth - marginX - 70, totalsY + 11, 70, 8, 'F');
  doc.setFont('helvetica', 'bold');
  doc.text('TOTAL:', pageWidth - marginX - 66, totalsY + 17);
  doc.text(formatMoney(invoice?.total), pageWidth - marginX, totalsY + 17, { align: 'right' });

  const paymentY = totalsY + 26;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(0, 0, 0);
  doc.text('PAYMENT DETAILS', marginX, paymentY);

  doc.setFont('helvetica', 'normal');
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
