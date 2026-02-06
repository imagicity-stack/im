import net from 'node:net';
import tls from 'node:tls';
import fs from 'node:fs';
import path from 'node:path';
import { NextResponse } from 'next/server';
import { getAdminAuth, getFirestore } from '@/server/firebaseAdmin';

const json = (data, status = 200) => NextResponse.json(data, { status });


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

let cachedLogoDataUri;

function getEmailLogoDataUri() {
  if (cachedLogoDataUri !== undefined) return cachedLogoDataUri;

  try {
    const logoPath = path.join(process.cwd(), 'public', 'imagicity-logo.png');
    const logoBuffer = fs.readFileSync(logoPath);
    cachedLogoDataUri = `data:image/png;base64,${logoBuffer.toString('base64')}`;
  } catch {
    cachedLogoDataUri = '';
  }

  return cachedLogoDataUri;
}

function buildInvoiceEmailHtml({ client, invoice, settings }) {
  const companyName = settings?.company_name || 'IMAGICITY';
  const companyAddress = settings?.company_address || 'N/A';
  const companyGstin = settings?.company_gstin || 'N/A';
  const logoDataUri = getEmailLogoDataUri();

  const subtotal = Number(invoice.subtotal || 0);
  const igst = Number(invoice.igst || 0);
  const cgst = Number(invoice.cgst || 0);
  const sgst = Number(invoice.sgst || 0);
  const total = Number(invoice.total || 0);
  const items = Array.isArray(invoice.items) ? invoice.items : [];
  const noteHtml = invoice?.notes ? `<div style="margin-top:18px;padding:12px;background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;"><div style="font-weight:700;margin-bottom:4px;">Notes</div><div>${escapeHtml(invoice.notes)}</div></div>` : '';

  const rows = items.map((item, index) => `
    <tr>
      <td style="padding:10px;border-bottom:1px solid #eee;text-align:center;">${index + 1}</td>
      <td style="padding:10px;border-bottom:1px solid #eee;">${escapeHtml(item.description || '-')}</td>
      <td style="padding:10px;border-bottom:1px solid #eee;text-align:center;">${escapeHtml(item.quantity || 0)}</td>
      <td style="padding:10px;border-bottom:1px solid #eee;text-align:right;">₹${Number(item.rate || 0).toFixed(2)}</td>
      <td style="padding:10px;border-bottom:1px solid #eee;text-align:right;">₹${Number(item.amount || 0).toFixed(2)}</td>
    </tr>
  `).join('');

  const clientDetails = [
    client?.name || 'Client',
    client?.email ? `Email: ${client.email}` : '',
    client?.phone ? `Phone: ${client.phone}` : '',
    client?.gstin ? `GSTIN: ${client.gstin}` : '',
    client?.address || '',
  ].filter(Boolean).map((line) => `<div>${escapeHtml(line)}</div>`).join('');

  return `
  <div style="font-family:Arial,sans-serif;background:#f6f8fb;padding:24px;color:#1f2937;">
    <div style="max-width:760px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;">
      <div style="background:#111827;color:#ffffff;padding:20px 24px;display:flex;justify-content:space-between;align-items:center;gap:16px;">
        <div>
          <h1 style="margin:0;font-size:20px;">${escapeHtml(companyName)}</h1>
          <p style="margin:6px 0 0;font-size:13px;opacity:.9;">Invoice ${escapeHtml(invoice.invoice_number || 'N/A')}</p>
        </div>
        ${logoDataUri ? `<img src="${logoDataUri}" alt="${escapeHtml(companyName)} logo" style="height:42px;max-width:180px;object-fit:contain;background:#fff;padding:6px;border-radius:8px;" />` : ''}
      </div>

      <div style="padding:24px;">
        <p style="margin-top:0;">Hi ${escapeHtml(client.name || 'Client')},</p>
        <p>Please find your invoice details below.</p>

        <table style="width:100%;border-collapse:collapse;background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;margin:14px 0 6px;">
          <tr>
            <td style="padding:10px;font-weight:600;width:35%;">Invoice Number</td>
            <td style="padding:10px;">${escapeHtml(invoice.invoice_number || 'N/A')}</td>
          </tr>
          <tr>
            <td style="padding:10px;font-weight:600;">Invoice Date</td>
            <td style="padding:10px;">${escapeHtml(invoice.invoice_date || 'N/A')}</td>
          </tr>
          <tr>
            <td style="padding:10px;font-weight:600;">Due Date</td>
            <td style="padding:10px;">${escapeHtml(invoice.due_date || 'N/A')}</td>
          </tr>
          <tr>
            <td style="padding:10px;font-weight:600;">Status</td>
            <td style="padding:10px;">${escapeHtml(invoice.status || 'pending')}</td>
          </tr>
          <tr>
            <td style="padding:10px;font-weight:600;">Type</td>
            <td style="padding:10px;">${escapeHtml(invoice.invoice_type || 'invoice')}</td>
          </tr>
        </table>

        <table role="presentation" style="width:100%;border-collapse:separate;border-spacing:12px;margin:16px 0;">
          <tr>
            <td style="vertical-align:top;width:50%;border:1px solid #e5e7eb;border-radius:8px;padding:12px;background:#f9fafb;">
              <div style="font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:#6b7280;margin-bottom:8px;">Billed By</div>
              <div style="font-weight:700;">${escapeHtml(companyName)}</div>
              <div style="margin-top:6px;">GSTIN: ${escapeHtml(companyGstin)}</div>
              <div style="margin-top:6px;line-height:1.4;">${escapeHtml(companyAddress)}</div>
            </td>
            <td style="vertical-align:top;width:50%;border:1px solid #e5e7eb;border-radius:8px;padding:12px;background:#f9fafb;">
              <div style="font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:#6b7280;margin-bottom:8px;">Billed To</div>
              ${clientDetails}
            </td>
          </tr>
        </table>

        <table style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;margin:10px 0 20px;">
          <thead>
            <tr style="background:#f3f4f6;">
              <th style="padding:10px;text-align:center;width:52px;">#</th>
              <th style="padding:10px;text-align:left;">Description</th>
              <th style="padding:10px;text-align:center;">Qty</th>
              <th style="padding:10px;text-align:right;">Rate</th>
              <th style="padding:10px;text-align:right;">Amount</th>
            </tr>
          </thead>
          <tbody>${rows || `<tr><td colspan="5" style="padding:12px;text-align:center;color:#6b7280;">No line items</td></tr>`}</tbody>
        </table>

        <table style="width:100%;max-width:320px;margin-left:auto;border-collapse:collapse;">
          <tr><td style="padding:6px 0;color:#6b7280;">Subtotal</td><td style="padding:6px 0;text-align:right;">₹${subtotal.toFixed(2)}</td></tr>
          <tr><td style="padding:6px 0;color:#6b7280;">CGST</td><td style="padding:6px 0;text-align:right;">₹${cgst.toFixed(2)}</td></tr>
          <tr><td style="padding:6px 0;color:#6b7280;">SGST</td><td style="padding:6px 0;text-align:right;">₹${sgst.toFixed(2)}</td></tr>
          <tr><td style="padding:6px 0;color:#6b7280;">IGST</td><td style="padding:6px 0;text-align:right;">₹${igst.toFixed(2)}</td></tr>
          <tr><td style="padding:10px 0;font-size:16px;font-weight:700;">Total</td><td style="padding:10px 0;text-align:right;font-size:16px;font-weight:700;">₹${total.toFixed(2)}</td></tr>
        </table>

        ${noteHtml}

        <div style="margin-top:24px;padding:14px;border:1px dashed #d1d5db;border-radius:8px;background:#fafafa;">
          <div style="font-weight:700;margin-bottom:6px;">Payment Details</div>
          <div>Bank: ${escapeHtml(settings?.bank_name || 'N/A')}</div>
          <div>Account Number: ${escapeHtml(settings?.account_number || 'N/A')}</div>
          <div>IFSC: ${escapeHtml(settings?.ifsc_code || 'N/A')}</div>
          <div>UPI: ${escapeHtml(settings?.upi_id || 'N/A')}</div>
        </div>

        <div style="margin-top:24px;padding-top:14px;border-top:1px solid #e5e7eb;font-size:12px;color:#6b7280;line-height:1.5;">
          <div style="font-weight:700;color:#374151;">${escapeHtml(companyName)}</div>
          <div>${escapeHtml(companyAddress)}</div>
          <div>GSTIN: ${escapeHtml(companyGstin)}</div>
          <div style="margin-top:8px;">Thank you for your business.</div>
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

function buildMimeMessage({ from, to, subject, text, html }) {
  const boundary = `imagicity-${Date.now().toString(16)}`;
  const cleanText = (text || '').replace(/\r?\n/g, '\r\n');

  return [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 7bit',
    '',
    cleanText,
    '',
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: 7bit',
    '',
    html || `<p>${cleanText.replace(/\r\n/g, '<br />')}</p>`,
    '',
    `--${boundary}--`,
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

    const mime = buildMimeMessage({ from: fromHeader, to, subject, text, html });
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

  if (route === 'invoices') return json(await listByUser(db, 'invoices', uid));
  if (route.startsWith('invoices/')) {
    const id = path[1];
    if (path[2] === 'convert-to-invoice' || path[2] === 'send-email') return json({ detail: 'Method not allowed' }, 405);
    const doc = await db.collection('invoices').doc(id).get();
    if (!doc.exists || doc.data().user_id !== uid) return json({ detail: 'Invoice not found' }, 404);
    return json(doc.data());
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
      listByUser(db, 'invoices', uid),
      listByUser(db, 'expenses', uid),
    ]);
    const totalRevenue = invoices.reduce((s, i) => s + Number(i.total || 0), 0);
    const totalExpenses = expenses.reduce((s, i) => s + Number(i.amount || 0), 0);
    return json({
      total_clients: clients.length,
      total_services: services.length,
      total_invoices: invoices.length,
      total_expenses: totalExpenses,
      total_revenue: totalRevenue,
      pending_invoices: invoices.filter((i) => i.status === 'pending').length,
      paid_invoices: invoices.filter((i) => i.status === 'paid').length,
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
    const settingsRef = db.collection('settings').doc(uid);
    const settingsSnap = await settingsRef.get();
    const settings = settingsSnap.exists ? settingsSnap.data() : { invoice_prefix: 'INV', invoice_counter: 1 };
    const invoiceNumber = `${settings.invoice_prefix}-${String(settings.invoice_counter).padStart(4, '0')}`;
    const ref = db.collection('invoices').doc();
    const payload = withMeta({ ...body, invoice_number: invoiceNumber }, uid, ref.id);
    await ref.set(payload);
    await settingsRef.set({ ...settings, invoice_counter: (settings.invoice_counter || 1) + 1, user_id: uid, id: uid }, { merge: true });
    return json(payload);
  }

  if (route.endsWith('/convert-to-invoice') && path[0] === 'invoices') {
    const id = path[1];
    const ref = db.collection('invoices').doc(id);
    const snap = await ref.get();
    if (!snap.exists || snap.data().user_id !== uid) return json({ detail: 'Invoice not found' }, 404);
    await ref.set({ invoice_type: 'invoice' }, { merge: true });
    return json({ message: 'Converted successfully' });
  }

  if (route.endsWith('/send-email') && path[0] === 'invoices') {
    const id = path[1];
    const invoiceSnap = await db.collection('invoices').doc(id).get();
    if (!invoiceSnap.exists || invoiceSnap.data().user_id !== uid) return json({ detail: 'Invoice not found' }, 404);

    const invoice = invoiceSnap.data();
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
  if (path[0] === 'invoices' && path[1]) return updateEntity('invoices', path[1], 'Invoice not found');
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
  if (path[0] === 'invoices' && path[1]) return remove('invoices', path[1], 'Invoice');
  if (path[0] === 'expenses' && path[1]) return remove('expenses', path[1], 'Expense');

  return json({ detail: 'Not found' }, 404);
}
