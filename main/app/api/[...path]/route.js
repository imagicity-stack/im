import net from 'node:net';
import tls from 'node:tls';
import fs from 'node:fs';
import path from 'node:path';
import { NextResponse } from 'next/server';
import { getAdminAuth, getFirestore } from '@/server/firebaseAdmin';

const json = (data, status = 200) => NextResponse.json(data, { status });

const INVOICE_COLLECTIONS = {
  invoice: 'invoices',
  proforma: 'proformas',
  sale_receipt: 'final_sales',
};

const INVOICE_COLLECTION_LIST = Object.values(INVOICE_COLLECTIONS);

function getSmtpConfig() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 465);
  const secure = String(process.env.SMTP_SECURE || 'true').toLowerCase() !== 'false';
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM || user;
  const fromName = process.env.SMTP_FROM_NAME || 'IMAGICITY';

  if (!host || !port || !user || !pass || !from) {
    throw new Error('SMTP is not configured. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, and SMTP_FROM.');
  }

  return { host, port, secure, user, pass, from, fromName };
}

function formatFromHeader(fromName, fromEmail) {
  const safeName = String(fromName || '').replace(/"/g, '');
  return safeName ? `"${safeName}" <${fromEmail}>` : fromEmail;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

let cachedLogoBase64;

function getEmailLogoBase64() {
  if (cachedLogoBase64 !== undefined) return cachedLogoBase64;

  try {
    const logoPath = path.join(process.cwd(), 'public', 'imagicity-logo.png');
    const logoBuffer = fs.readFileSync(logoPath);
    cachedLogoBase64 = logoBuffer.toString('base64');
  } catch {
    cachedLogoBase64 = '';
  }

  return cachedLogoBase64;
}

function buildInvoiceEmailHtml({ client, invoice, settings }) {
  const companyName = settings?.company_name || 'IMAGICITY';
  const companyAddress = settings?.company_address || 'N/A';
  const companyGstin = settings?.company_gstin || 'N/A';
  const hasLogo = Boolean(getEmailLogoBase64());

  const subtotal = Number(invoice.subtotal || 0);
  const igst = Number(invoice.igst || 0);
  const total = Number(invoice.total || 0);
  const invoiceNumber = invoice.invoice_number || 'N/A';
  const invoiceDate = invoice.invoice_date || 'N/A';
  const dueDate = invoice.due_date || 'N/A';
  const status = invoice.status || 'pending';
  const invoiceType = invoice.invoice_type || 'invoice';
  const items = Array.isArray(invoice.items) ? invoice.items : [];
  const notes = invoice?.notes || '';

  const rows = items.map((item, index) => `
    <tr>
      <td style="padding:10px;border-bottom:1px solid #e5e7eb;text-align:center;">${index + 1}</td>
      <td style="padding:10px;border-bottom:1px solid #e5e7eb;">${escapeHtml(item.description || '-')}</td>
      <td style="padding:10px;border-bottom:1px solid #e5e7eb;text-align:center;">${escapeHtml(item.quantity || 0)}</td>
      <td style="padding:10px;border-bottom:1px solid #e5e7eb;text-align:right;">₹${Number(item.rate || 0).toFixed(2)}</td>
      <td style="padding:10px;border-bottom:1px solid #e5e7eb;text-align:right;">₹${Number(item.amount || 0).toFixed(2)}</td>
    </tr>
  `).join('');

  const clientName = client?.business_name || client?.name || 'Client';
  const clientDetails = [
    clientName,
    client?.email ? `Email: ${client.email}` : '',
    client?.phone ? `Phone: ${client.phone}` : '',
    client?.gstin ? `GSTIN: ${client.gstin}` : '',
    client?.address || '',
  ].filter(Boolean).map((line) => `<div style="margin-top:4px;">${escapeHtml(line)}</div>`).join('');

  const noteHtml = notes
    ? `<div style="margin-top:16px;padding:12px;border:1px solid #fde68a;background:#fffbeb;border-radius:8px;"><div style="font-weight:700;margin-bottom:4px;">Notes</div><div>${escapeHtml(notes)}</div></div>`
    : '';

  return `
  <div style="margin:0;background:#f3f4f6;padding:24px;font-family:Arial,sans-serif;color:#111827;">
    <div style="max-width:780px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;">
      <div style="background:#ffffff;padding:18px 22px;border-bottom:2px solid #e5e7eb;display:flex;justify-content:space-between;align-items:center;gap:12px;">
        <div>
          <div style="font-size:24px;font-weight:800;color:#111827;letter-spacing:.3px;">${escapeHtml(companyName)}</div>
          <div style="font-size:12px;color:#6b7280;margin-top:3px;">Tax Invoice</div>
        </div>
        ${hasLogo ? `<img src="cid:imagicity-logo" alt="${escapeHtml(companyName)} logo" style="height:48px;max-width:170px;object-fit:contain;" />` : ''}
      </div>

      <div style="padding:20px 22px;">
        <table style="width:100%;border-collapse:collapse;background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
          <tr>
            <td style="padding:9px 10px;font-weight:700;width:30%;">Invoice No.</td>
            <td style="padding:9px 10px;">${escapeHtml(invoiceNumber)}</td>
            <td style="padding:9px 10px;font-weight:700;width:20%;">Status</td>
            <td style="padding:9px 10px;text-transform:capitalize;">${escapeHtml(status)}</td>
          </tr>
          <tr>
            <td style="padding:9px 10px;font-weight:700;">Invoice Date</td>
            <td style="padding:9px 10px;">${escapeHtml(invoiceDate)}</td>
            <td style="padding:9px 10px;font-weight:700;">Due Date</td>
            <td style="padding:9px 10px;">${escapeHtml(dueDate)}</td>
          </tr>
          <tr>
            <td style="padding:9px 10px;font-weight:700;">Invoice Type</td>
            <td style="padding:9px 10px;text-transform:capitalize;">${escapeHtml(invoiceType)}</td>
            <td style="padding:9px 10px;font-weight:700;">Currency</td>
            <td style="padding:9px 10px;">INR (₹)</td>
          </tr>
        </table>

        <table role="presentation" style="width:100%;border-collapse:separate;border-spacing:12px;margin:16px 0 8px;">
          <tr>
            <td style="vertical-align:top;width:50%;border:1px solid #e5e7eb;border-radius:8px;padding:12px;background:#ffffff;">
              <div style="font-size:12px;text-transform:uppercase;color:#6b7280;font-weight:700;margin-bottom:6px;">Billed By</div>
              <div style="font-weight:700;">${escapeHtml(companyName)}</div>
              <div style="margin-top:4px;">GSTIN: ${escapeHtml(companyGstin)}</div>
              <div style="margin-top:4px;line-height:1.4;">${escapeHtml(companyAddress)}</div>
            </td>
            <td style="vertical-align:top;width:50%;border:1px solid #e5e7eb;border-radius:8px;padding:12px;background:#ffffff;">
              <div style="font-size:12px;text-transform:uppercase;color:#6b7280;font-weight:700;margin-bottom:6px;">Billed To</div>
              ${clientDetails}
            </td>
          </tr>
        </table>

        <table style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;margin-top:8px;">
          <thead>
            <tr style="background:#f3f4f6;">
              <th style="padding:10px;text-align:center;width:44px;">#</th>
              <th style="padding:10px;text-align:left;">Description</th>
              <th style="padding:10px;text-align:center;width:80px;">Qty</th>
              <th style="padding:10px;text-align:right;width:120px;">Rate</th>
              <th style="padding:10px;text-align:right;width:140px;">Amount</th>
            </tr>
          </thead>
          <tbody>${rows || `<tr><td colspan="5" style="padding:14px;text-align:center;color:#6b7280;">No line items</td></tr>`}</tbody>
        </table>

        <table style="width:100%;max-width:340px;margin:14px 0 0 auto;border-collapse:collapse;">
          <tr><td style="padding:6px 0;color:#6b7280;">Subtotal</td><td style="padding:6px 0;text-align:right;">₹${subtotal.toFixed(2)}</td></tr>
          <tr><td style="padding:6px 0;color:#6b7280;">IGST</td><td style="padding:6px 0;text-align:right;">₹${igst.toFixed(2)}</td></tr>
          <tr><td style="padding:10px 0;font-weight:800;font-size:16px;">Grand Total</td><td style="padding:10px 0;text-align:right;font-weight:800;font-size:16px;">₹${total.toFixed(2)}</td></tr>
        </table>

        ${noteHtml}

        <div style="margin-top:16px;padding:12px;border:1px dashed #d1d5db;border-radius:8px;background:#fafafa;">
          <div style="font-weight:700;margin-bottom:6px;">Payment Details</div>
          <div style="margin-top:3px;">Bank: ${escapeHtml(settings?.bank_name || 'N/A')}</div>
          <div style="margin-top:3px;">Account Number: ${escapeHtml(settings?.account_number || 'N/A')}</div>
          <div style="margin-top:3px;">IFSC: ${escapeHtml(settings?.ifsc_code || 'N/A')}</div>
          <div style="margin-top:3px;">UPI: ${escapeHtml(settings?.upi_id || 'N/A')}</div>
        </div>

        <div style="margin-top:16px;padding-top:12px;border-top:1px solid #e5e7eb;font-size:12px;color:#6b7280;line-height:1.5;">
          <div style="font-weight:700;color:#111827;">${escapeHtml(companyName)}</div>
          <div>${escapeHtml(companyAddress)}</div>
          <div>GSTIN: ${escapeHtml(companyGstin)}</div>
          <div style="margin-top:7px;">This is a system generated invoice email.</div>
        </div>
      </div>
    </div>
  </div>`;
}


function makeSmtpClient({ host, port, secure }) {
  return secure
    ? tls.connect({ host, port, servername: host })
    : net.createConnection({ host, port });
}

function buildMimeMessage({ from, to, subject, text, html, inlineLogoBase64 }) {
  const altBoundary = `imagicity-alt-${Date.now().toString(16)}`;
  const relatedBoundary = `imagicity-rel-${Date.now().toString(16)}`;
  const cleanText = (text || '').replace(/\r?\n/g, '\r\n');
  const cleanHtml = html || `<p>${cleanText.replace(/\r\n/g, '<br />')}</p>`;

  const baseHeaders = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
  ];

  if (!inlineLogoBase64) {
    return [
      ...baseHeaders,
      `Content-Type: multipart/alternative; boundary="${altBoundary}"`,
      '',
      `--${altBoundary}`,
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: 7bit',
      '',
      cleanText,
      '',
      `--${altBoundary}`,
      'Content-Type: text/html; charset=UTF-8',
      'Content-Transfer-Encoding: 7bit',
      '',
      cleanHtml,
      '',
      `--${altBoundary}--`,
      '',
    ].join('\r\n');
  }

  const chunkedLogo = inlineLogoBase64.match(/.{1,76}/g)?.join('\r\n') || inlineLogoBase64;

  return [
    ...baseHeaders,
    `Content-Type: multipart/related; boundary="${relatedBoundary}"`,
    '',
    `--${relatedBoundary}`,
    `Content-Type: multipart/alternative; boundary="${altBoundary}"`,
    '',
    `--${altBoundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 7bit',
    '',
    cleanText,
    '',
    `--${altBoundary}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: 7bit',
    '',
    cleanHtml,
    '',
    `--${altBoundary}--`,
    '',
    `--${relatedBoundary}`,
    'Content-Type: image/png; name="imagicity-logo.png"',
    'Content-Transfer-Encoding: base64',
    'Content-ID: <imagicity-logo>',
    'Content-Disposition: inline; filename="imagicity-logo.png"',
    '',
    chunkedLogo,
    '',
    `--${relatedBoundary}--`,
    '',
  ].join('\r\n');
}


async function sendMailViaSmtp({ to, subject, text, html }) {
  const smtp = getSmtpConfig();
  const fromHeader = formatFromHeader(smtp.fromName, smtp.from);
  const socket = makeSmtpClient(smtp);

  let buffer = '';

  const waitForCode = (expectedCode) => new Promise((resolve, reject) => {
    const onData = (chunk) => {
      buffer += chunk.toString('utf8');
      const lines = buffer.split('\r\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line) continue;
        if (/^\d{3} /.test(line)) {
          const code = Number(line.slice(0, 3));
          if (Array.isArray(expectedCode) ? expectedCode.includes(code) : code === expectedCode) {
            socket.off('data', onData);
            resolve(line);
            return;
          }
          socket.off('data', onData);
          reject(new Error(`SMTP error ${line}`));
          return;
        }
      }
    };

    socket.on('data', onData);
  });

  const sendCommand = async (command, expectedCode) => {
    socket.write(`${command}\r\n`);
    await waitForCode(expectedCode);
  };

  await new Promise((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('error', reject);
  });

  try {
    await waitForCode(220);
    await sendCommand('EHLO imagicity.app', 250);
    await sendCommand('AUTH LOGIN', 334);
    await sendCommand(Buffer.from(smtp.user).toString('base64'), 334);
    await sendCommand(Buffer.from(smtp.pass).toString('base64'), 235);
    await sendCommand(`MAIL FROM:<${smtp.from}>`, 250);
    await sendCommand(`RCPT TO:<${to}>`, [250, 251]);
    await sendCommand('DATA', 354);

    const inlineLogoBase64 = getEmailLogoBase64();
    const mime = buildMimeMessage({ from: fromHeader, to, subject, text, html, inlineLogoBase64 });
    socket.write(`${mime}\r\n.\r\n`);
    await waitForCode(250);
    await sendCommand('QUIT', 221);
  } finally {
    socket.end();
  }
}

async function getAuthContext(req, { adminOnly = true } = {}) {
  const header = req.headers.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return { error: json({ detail: 'Missing token' }, 401) };

  try {
    const decoded = await getAdminAuth().verifyIdToken(token);
    const db = getFirestore();
    const userRef = db.collection('users').doc(decoded.uid);
    const userSnap = await userRef.get();
    const userData = userSnap.exists ? userSnap.data() : null;

    if (adminOnly && userData?.role !== 'admin') {
      return { error: json({ detail: 'Admin access required' }, 403) };
    }

    return { uid: decoded.uid, userData, db, userRef };
  } catch {
    return { error: json({ detail: 'Invalid token' }, 401) };
  }
}

function withMeta(payload, uid, id) {
  return {
    ...payload,
    id,
    user_id: uid,
    created_at: new Date().toISOString(),
  };
}

async function listByUser(db, collection, uid) {
  const snap = await db.collection(collection).where('user_id', '==', uid).get();
  return snap.docs.map((doc) => doc.data());
}

async function listAllInvoices(db, uid) {
  const [invoices, proformas, saleReceipts] = await Promise.all([
    listByUser(db, INVOICE_COLLECTIONS.invoice, uid),
    listByUser(db, INVOICE_COLLECTIONS.proforma, uid),
    listByUser(db, INVOICE_COLLECTIONS.sale_receipt, uid),
  ]);
  return [...invoices, ...proformas, ...saleReceipts];
}

function resolveInvoiceCollection(type) {
  return INVOICE_COLLECTIONS[type] || INVOICE_COLLECTIONS.invoice;
}

async function findInvoiceDoc(db, uid, id) {
  for (const collection of INVOICE_COLLECTION_LIST) {
    const doc = await db.collection(collection).doc(id).get();
    if (doc.exists && doc.data().user_id === uid) {
      return { collection, doc, data: doc.data() };
    }
  }
  return null;
}

export async function GET(req, { params }) {
  const path = params.path || [];
  const route = path.join('/');

  if (route === '') return json({ message: 'Imagicity Invoice API', status: 'running' });

  const auth = await getAuthContext(req);
  if (auth.error) return auth.error;

  const { db, uid, userData } = auth;

  if (route === 'auth/me') {
    return json({ id: uid, email: userData?.email || '', name: userData?.name || '', role: userData?.role || 'user' });
  }

  if (route === 'clients') return json(await listByUser(db, 'clients', uid));
  if (route.startsWith('clients/')) {
    const doc = await db.collection('clients').doc(path[1]).get();
    if (!doc.exists || doc.data().user_id !== uid) return json({ detail: 'Client not found' }, 404);
    return json(doc.data());
  }

  if (route === 'services') return json(await listByUser(db, 'services', uid));
  if (route.startsWith('services/')) {
    const doc = await db.collection('services').doc(path[1]).get();
    if (!doc.exists || doc.data().user_id !== uid) return json({ detail: 'Service not found' }, 404);
    return json(doc.data());
  }

  if (route === 'invoices') return json(await listAllInvoices(db, uid));
  if (route.startsWith('invoices/')) {
    const id = path[1];
    if (path[2] === 'send-email') return json({ detail: 'Method not allowed' }, 405);
    const result = await findInvoiceDoc(db, uid, id);
    if (!result) return json({ detail: 'Invoice not found' }, 404);
    return json(result.data);
  }

  if (route === 'expenses') return json(await listByUser(db, 'expenses', uid));
  if (route === 'settings') {
    const doc = await db.collection('settings').doc(uid).get();
    if (!doc.exists) {
      const defaults = {
        id: uid,
        user_id: uid,
        invoice_prefix: 'INV',
        invoice_counter: 1,
        proforma_prefix: 'PRO',
        proforma_counter: 1,
        company_name: 'IMAGICITY',
        company_gstin: '20JVPPK2424H1ZM',
        company_address: 'Kolghatti, Near Black Water tank, reformatory school, hazaribagh, Jharkhand, 825301',
        bank_name: 'Federal Bank',
        account_number: '25060200000912',
        ifsc_code: 'FDRL0002506',
        upi_id: 'biz.imagicit587@fbl',
      };
      await db.collection('settings').doc(uid).set(defaults);
      return json(defaults);
    }
    return json(doc.data());
  }

  if (route === 'dashboard/stats') {
    const [clients, services, invoices, expenses] = await Promise.all([
      listByUser(db, 'clients', uid),
      listByUser(db, 'services', uid),
      listByUser(db, INVOICE_COLLECTIONS.invoice, uid),
      listByUser(db, 'expenses', uid),
    ]);
    const getAmountPaid = (invoice) => {
      const total = Number(invoice.total || 0);
      const amountPaid = Number(invoice.amount_paid ?? (invoice.status === 'paid' ? total : 0));
      return Math.min(Math.max(amountPaid, 0), total);
    };
    const getTotalDue = (invoice) => {
      const total = Number(invoice.total || 0);
      return Math.max(total - getAmountPaid(invoice), 0);
    };
    const totalRevenue = invoices.reduce((sum, invoice) => sum + getAmountPaid(invoice), 0);
    const pendingAmount = invoices
      .filter((invoice) => invoice.status === 'pending')
      .reduce((sum, invoice) => sum + getTotalDue(invoice), 0);
    const overdueAmount = invoices
      .filter((invoice) => invoice.status === 'overdue')
      .reduce((sum, invoice) => sum + getTotalDue(invoice), 0);
    const totalExpenses = expenses.reduce((s, i) => s + Number(i.amount || 0), 0);
    return json({
      total_clients: clients.length,
      total_services: services.length,
      total_invoices: invoices.length,
      total_expenses: totalExpenses,
      total_revenue: totalRevenue,
      pending_invoices: invoices.filter((i) => i.status === 'pending').length,
      paid_invoices: invoices.filter((i) => i.status === 'paid').length,
      client_count: clients.length,
      invoice_count: invoices.length,
      pending_amount: pendingAmount,
      overdue_amount: overdueAmount,
    });
  }

  return json({ detail: 'Not found' }, 404);
}

export async function POST(req, { params }) {
  const path = params.path || [];
  const route = path.join('/');

  const readJsonBody = async () => {
    const contentLength = req.headers.get('content-length');
    if (contentLength === '0') return {};
    try {
      return await req.json();
    } catch {
      return {};
    }
  };

  if (route === 'auth/signup') {
    const auth = await getAuthContext(req, { adminOnly: false });
    if (auth.error) return auth.error;
    const { db, uid, userRef } = auth;
    const body = await req.json();
    const existingAdmins = await db.collection('users').where('role', '==', 'admin').limit(1).get();
    const role = existingAdmins.empty ? 'admin' : 'user';
    const userPayload = {
      id: uid,
      email: auth.userData?.email || '',
      name: body.name || auth.userData?.name || '',
      role,
      created_at: new Date().toISOString(),
    };
    await userRef.set(userPayload, { merge: true });
    return json({ access_token: req.headers.get('authorization')?.slice(7) || '', token_type: 'bearer', user: userPayload });
  }

  const auth = await getAuthContext(req);
  if (auth.error) return auth.error;
  const { db, uid } = auth;

  if (route === 'clients') {
    const body = await readJsonBody();
    const ref = db.collection('clients').doc();
    const payload = withMeta(body, uid, ref.id);
    await ref.set(payload);
    return json(payload);
  }

  if (route === 'services') {
    const body = await readJsonBody();
    const ref = db.collection('services').doc();
    const payload = withMeta(body, uid, ref.id);
    await ref.set(payload);
    return json(payload);
  }

  if (route === 'invoices') {
    const body = await readJsonBody();
    const invoiceType = body.invoice_type || 'invoice';
    const settingsRef = db.collection('settings').doc(uid);
    const settingsSnap = await settingsRef.get();
    const settings = settingsSnap.exists
      ? settingsSnap.data()
      : { invoice_prefix: 'INV', invoice_counter: 1, proforma_prefix: 'PRO', proforma_counter: 1 };
    const collection = resolveInvoiceCollection(invoiceType);
    const ref = db.collection(collection).doc();
    let invoiceNumber = body.invoice_number;
    const updatedSettings = { ...settings };

    if (invoiceType === 'invoice') {
      invoiceNumber = invoiceNumber || `${settings.invoice_prefix || 'INV'}-${String(settings.invoice_counter || 1).padStart(4, '0')}`;
      updatedSettings.invoice_counter = (settings.invoice_counter || 1) + 1;
    } else if (invoiceType === 'proforma') {
      invoiceNumber = invoiceNumber || `${settings.proforma_prefix || 'PRO'}-${String(settings.proforma_counter || 1).padStart(4, '0')}`;
      updatedSettings.proforma_counter = (settings.proforma_counter || 1) + 1;
    } else if (invoiceType === 'sale_receipt') {
      invoiceNumber = invoiceNumber || (body.source_invoice_number ? `SR-${body.source_invoice_number}` : `SR-${Date.now()}`);
    }

    const payload = withMeta({ ...body, invoice_number: invoiceNumber, invoice_type: invoiceType }, uid, ref.id);
    await ref.set(payload);
    await settingsRef.set({ ...updatedSettings, user_id: uid, id: uid }, { merge: true });
    return json(payload);
  }

  if (route.endsWith('/send-email') && path[0] === 'invoices') {
    const id = path[1];
    const invoiceResult = await findInvoiceDoc(db, uid, id);
    if (!invoiceResult) return json({ detail: 'Invoice not found' }, 404);

    const invoice = invoiceResult.data;
    const clientSnap = await db.collection('clients').doc(invoice.client_id).get();
    if (!clientSnap.exists || clientSnap.data().user_id !== uid) return json({ detail: 'Client not found' }, 404);

    const client = clientSnap.data();
    if (!client.email) return json({ detail: 'Client email is missing' }, 400);

    const settingsSnap = await db.collection('settings').doc(uid).get();
    const settings = settingsSnap.exists ? settingsSnap.data() : {};

    const subject = `Invoice ${invoice.invoice_number} from IMAGICITY`;
    const text = `Hi ${client.name || 'Client'},

Your invoice ${invoice.invoice_number} for amount ₹${Number(invoice.total || 0).toFixed(2)} is ready.

Invoice Date: ${invoice.invoice_date || 'N/A'}
Due Date: ${invoice.due_date || 'N/A'}

Thanks,
IMAGICITY`;
    const html = buildInvoiceEmailHtml({ client, invoice, settings });

    try {
      await sendMailViaSmtp({
        to: client.email,
        subject,
        text,
        html,
      });
      return json({ message: `Email sent successfully to ${client.email}` });
    } catch (error) {
      return json({ detail: error.message || 'SMTP email dispatch failed' }, 500);
    }
  }

  if (route === 'expenses') {
    const body = await readJsonBody();
    const ref = db.collection('expenses').doc();
    const payload = withMeta(body, uid, ref.id);
    await ref.set(payload);
    return json(payload);
  }

  return json({ detail: 'Not found' }, 404);
}

export async function PUT(req, { params }) {
  const path = params.path || [];
  const route = path.join('/');
  const auth = await getAuthContext(req);
  if (auth.error) return auth.error;

  const { db, uid } = auth;
  const body = await req.json();

  const updateEntity = async (collection, id, notFound) => {
    const ref = db.collection(collection).doc(id);
    const snap = await ref.get();
    if (!snap.exists || snap.data().user_id !== uid) return json({ detail: notFound }, 404);
    const payload = { ...snap.data(), ...body, id, user_id: uid };
    await ref.set(payload);
    return json(payload);
  };

  if (path[0] === 'clients' && path[1]) return updateEntity('clients', path[1], 'Client not found');
  if (path[0] === 'services' && path[1]) return updateEntity('services', path[1], 'Service not found');
  if (path[0] === 'invoices' && path[1]) {
    const invoiceResult = await findInvoiceDoc(db, uid, path[1]);
    if (!invoiceResult) return json({ detail: 'Invoice not found' }, 404);
    const nextType = body.invoice_type || invoiceResult.data.invoice_type || 'invoice';
    const nextCollection = resolveInvoiceCollection(nextType);
    const payload = { ...invoiceResult.data, ...body, invoice_type: nextType, id: path[1], user_id: uid };

    if (nextCollection !== invoiceResult.collection) {
      await db.collection(nextCollection).doc(path[1]).set(payload);
      await db.collection(invoiceResult.collection).doc(path[1]).delete();
      return json(payload);
    }

    await db.collection(invoiceResult.collection).doc(path[1]).set(payload);
    return json(payload);
  }
  if (route === 'settings') {
    const payload = { ...body, id: uid, user_id: uid };
    await db.collection('settings').doc(uid).set(payload, { merge: true });
    return json(payload);
  }

  return json({ detail: 'Not found' }, 404);
}

export async function DELETE(req, { params }) {
  const path = params.path || [];
  const auth = await getAuthContext(req);
  if (auth.error) return auth.error;
  const { db, uid } = auth;

  const remove = async (collection, id, label) => {
    const ref = db.collection(collection).doc(id);
    const snap = await ref.get();
    if (!snap.exists || snap.data().user_id !== uid) return json({ detail: `${label} not found` }, 404);
    await ref.delete();
    return json({ message: `${label} deleted successfully` });
  };

  if (path[0] === 'clients' && path[1]) return remove('clients', path[1], 'Client');
  if (path[0] === 'services' && path[1]) return remove('services', path[1], 'Service');
  if (path[0] === 'invoices' && path[1]) {
    const invoiceResult = await findInvoiceDoc(db, uid, path[1]);
    if (!invoiceResult) return json({ detail: 'Invoice not found' }, 404);
    await db.collection(invoiceResult.collection).doc(path[1]).delete();
    if (invoiceResult.collection === INVOICE_COLLECTIONS.invoice) {
      const saleReceiptSnap = await db.collection(INVOICE_COLLECTIONS.sale_receipt)
        .where('user_id', '==', uid)
        .where('source_invoice_id', '==', path[1])
        .get();
      await Promise.all(saleReceiptSnap.docs.map((doc) => doc.ref.delete()));
    }
    return json({ message: 'Invoice deleted successfully' });
  }
  if (path[0] === 'expenses' && path[1]) return remove('expenses', path[1], 'Expense');

  return json({ detail: 'Not found' }, 404);
}
