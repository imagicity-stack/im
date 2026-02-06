import net from 'node:net';
import tls from 'node:tls';
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

  if (!host || !port || !user || !pass || !from) {
    throw new Error('SMTP is not configured. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, and SMTP_FROM.');
  }

  return { host, port, secure, user, pass, from };
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

    const mime = buildMimeMessage({ from: smtp.from, to, subject, text, html });
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

    const subject = `Invoice ${invoice.invoice_number} from IMAGICITY`;
    const text = `Hi ${client.name || 'Client'},

Your invoice ${invoice.invoice_number} for amount ₹${Number(invoice.total || 0).toFixed(2)} is ready.

Invoice Date: ${invoice.invoice_date || 'N/A'}
Due Date: ${invoice.due_date || 'N/A'}

Thanks,
IMAGICITY`;
    const html = `<p>Hi ${client.name || 'Client'},</p><p>Your invoice <strong>${invoice.invoice_number}</strong> for amount <strong>₹${Number(invoice.total || 0).toFixed(2)}</strong> is ready.</p><p><strong>Invoice Date:</strong> ${invoice.invoice_date || 'N/A'}<br /><strong>Due Date:</strong> ${invoice.due_date || 'N/A'}</p><p>Thanks,<br />IMAGICITY</p>`;

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
