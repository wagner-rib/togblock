import nodemailer from 'nodemailer';
import { orderAccessKey } from './auth';

function getTransport() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: false, // STARTTLS
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
    tls: { rejectUnauthorized: false },
  });
}

const FROM = process.env.SMTP_FROM ?? process.env.SMTP_USER;

interface OrderItem {
  product_type: string;
  custom_name: string;
  quantity: number;
  unit_price: number;
  thumbnail?: Buffer | null; // 3D-FIX-08: 512px PNG of the design, embedded inline
}

interface OrderEmailData {
  orderId: number;
  customerName: string;
  customerEmail: string;
  items: OrderItem[];
  shippingCost: number;
  total: number;
  address: {
    name: string; line1: string; line2?: string;
    city: string; county?: string; postcode?: string; country: string;
  };
}

function money(cents: number) { return `€${(cents / 100).toFixed(2)}`; }

const thumbCid = (i: number) => `design-${i}@togblocks`;

function itemRows(items: OrderItem[]) {
  return items.map((item, i) => `
    <tr>
      <td style="padding:10px 0;border-bottom:1px solid #e5e7eb">
        ${item.thumbnail ? `<img src="cid:${thumbCid(i)}" width="240" height="240" alt="Preview of ${escapeHtml(item.custom_name)}"
          style="display:block;width:240px;height:240px;border-radius:12px;margin:0 0 10px;background:#f6f2e7">` : ''}
        <strong>${item.product_type === 'door-sign' ? 'Door Sign' : 'Brick Letters'}</strong><br>
        <span style="color:#6b7280;font-size:14px">Name: ${escapeHtml(item.custom_name)}</span>
      </td>
      <td style="padding:10px 0;border-bottom:1px solid #e5e7eb;text-align:right">
        ${item.quantity} × ${money(item.unit_price)}
      </td>
    </tr>`).join('');
}

export async function sendOrderConfirmation(data: OrderEmailData) {
  const addressHtml = [
    data.address.name, data.address.line1, data.address.line2,
    data.address.city, data.address.county, data.address.postcode, data.address.country,
  ].filter(Boolean).join('<br>');

  const ref = `#TB${String(data.orderId).padStart(5, '0')}`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:'Segoe UI',Arial,sans-serif">
  <div style="max-width:600px;margin:32px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08)">
    <div style="background:#1D4ED8;padding:32px 40px;text-align:center">
      <div style="font-size:36px;margin-bottom:8px">🧱</div>
      <h1 style="color:#fff;margin:0;font-size:24px;font-weight:800">Order confirmed!</h1>
      <p style="color:rgba(255,255,255,.85);margin:8px 0 0;font-size:15px">We're already 3D printing it. 🇮🇪</p>
    </div>
    <div style="padding:32px 40px">
      <p style="color:#111827;font-size:16px;margin:0 0 24px">Hi ${data.customerName},</p>
      <p style="color:#374151;line-height:1.6;margin:0 0 24px">
        Thanks for your order — we're buzzing to make this one! Your build will be
        3D printed and quality-checked within 2–3 working days, then posted straight to you.
      </p>
      <div style="background:#f9fafb;border-radius:8px;padding:16px;margin-bottom:24px;font-size:14px;color:#6b7280">
        Order ref: <strong style="color:#111827">${ref}</strong>
      </div>
      <h2 style="font-size:16px;font-weight:700;color:#111827;margin:0 0 12px">Your order</h2>
      <table style="width:100%;border-collapse:collapse">
        <tbody>
          ${itemRows(data.items)}
          <tr>
            <td style="padding:10px 0;color:#6b7280">Shipping</td>
            <td style="padding:10px 0;text-align:right;color:#6b7280">${data.shippingCost === 0 ? 'Free' : money(data.shippingCost)}</td>
          </tr>
          <tr>
            <td style="padding:14px 0 0;font-size:18px;font-weight:800;color:#111827">Total</td>
            <td style="padding:14px 0 0;font-size:18px;font-weight:800;color:#1D4ED8;text-align:right">${money(data.total)}</td>
          </tr>
        </tbody>
      </table>
      <h2 style="font-size:16px;font-weight:700;color:#111827;margin:28px 0 12px">Delivery address</h2>
      <p style="color:#374151;line-height:1.8;margin:0">${addressHtml}</p>
      <div style="text-align:center;margin:32px 0">
        <a href="https://togblocks.com/orders/${data.orderId}?k=${orderAccessKey(data.orderId)}"
           style="display:inline-block;background:#1D4ED8;color:#fff;text-decoration:none;padding:14px 32px;border-radius:999px;font-weight:700;font-size:15px">
          View your order →
        </a>
      </div>
      <p style="color:#6b7280;font-size:14px;line-height:1.6">
        Questions? Reply to this email or contact us at
        <a href="mailto:togblocks@outlook.com" style="color:#1D4ED8">togblocks@outlook.com</a>.
        We're a small family team and we actually read every email. 💚
      </p>
    </div>
    <div style="background:#f9fafb;padding:20px 40px;text-align:center;font-size:12px;color:#9ca3af">
      TógBlocks · Made in Ireland 🇮🇪<br>
      Compatible with LEGO®. TógBlocks is independent and not affiliated with the LEGO Group.
    </div>
  </div>
</body>
</html>`;

  const transport = getTransport();

  await transport.sendMail({
    from: FROM,
    to: data.customerEmail,
    subject: `Your TógBlocks order ${ref} is confirmed! 🧱`,
    html,
    // Inline (cid:) attachments: shows in Gmail/Outlook/Apple Mail with no public image URL
    attachments: data.items.flatMap((item, i) => item.thumbnail
      ? [{ filename: `design-${i + 1}.png`, content: item.thumbnail, cid: thumbCid(i), contentType: 'image/png' }]
      : []),
  });

  // Notify the business
  await transport.sendMail({
    from: FROM,
    to: 'togblocks@outlook.com',
    subject: `New order ${ref} — ${data.customerName}`,
    html: `<p>New order from <strong>${data.customerName}</strong> (${data.customerEmail}).</p>
           <p>Total: ${money(data.total)}</p>
           <p>Items: ${data.items.map(i => i.custom_name).join(', ')}</p>`,
  });
}

export async function sendDispatchNotification(data: {
  orderId: number; customerName: string; customerEmail: string;
  trackingNumber?: string; carrier?: string;
}) {
  const ref     = `#TB${String(data.orderId).padStart(5, '0')}`;
  const carrier = data.carrier === 'an_post' ? 'An Post'
                : data.carrier === 'dhl'     ? 'DHL'
                : data.carrier === 'ups'     ? 'UPS'
                : data.carrier ?? 'our courier';

  const trackingSection = data.trackingNumber
    ? `<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:16px;margin:24px 0">
         <p style="margin:0 0 4px;font-weight:700;color:#15803d">Tracking number</p>
         <p style="margin:0;font-size:20px;font-weight:800;letter-spacing:.05em;color:#111827">${data.trackingNumber}</p>
         <p style="margin:4px 0 0;font-size:14px;color:#6b7280">via ${carrier}</p>
       </div>`
    : `<p style="color:#374151">We'll send tracking details as soon as they're available from ${carrier}.</p>`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:'Segoe UI',Arial,sans-serif">
  <div style="max-width:600px;margin:32px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08)">
    <div style="background:#1D4ED8;padding:32px 40px;text-align:center">
      <div style="font-size:36px;margin-bottom:8px">📦</div>
      <h1 style="color:#fff;margin:0;font-size:24px;font-weight:800">It's on its way!</h1>
      <p style="color:rgba(255,255,255,.85);margin:8px 0 0;font-size:15px">Your TógBlocks order has been dispatched 🚀</p>
    </div>
    <div style="padding:32px 40px">
      <p style="color:#111827;font-size:16px;margin:0 0 16px">Hi ${data.customerName},</p>
      <p style="color:#374151;line-height:1.6;margin:0 0 8px">
        Great news — your order <strong>${ref}</strong> has left us and is heading your way!
      </p>
      ${trackingSection}
      <p style="color:#374151;line-height:1.6">
        Standard delivery to Ireland is typically 1–3 working days from dispatch.
        If you have any questions, just reply to this email. 💚
      </p>
      <div style="text-align:center;margin:32px 0">
        <a href="https://togblocks.com/orders/${data.orderId}?k=${orderAccessKey(data.orderId)}"
           style="display:inline-block;background:#1D4ED8;color:#fff;text-decoration:none;padding:14px 32px;border-radius:999px;font-weight:700;font-size:15px">
          View your order →
        </a>
      </div>
    </div>
    <div style="background:#f9fafb;padding:20px 40px;text-align:center;font-size:12px;color:#9ca3af">
      TógBlocks · Made in Ireland 🇮🇪
    </div>
  </div>
</body>
</html>`;

  await getTransport().sendMail({
    from: FROM,
    to: data.customerEmail,
    subject: `Your order ${ref} is on its way! 📦`,
    html,
  });
}

export async function sendAdminMessage(data: {
  orderId: number; customerName: string; customerEmail: string;
  subject: string; body: string;
}) {
  const ref      = `#TB${String(data.orderId).padStart(5, '0')}`;
  const bodyHtml = data.body.replace(/\n/g, '<br>');

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:'Segoe UI',Arial,sans-serif">
  <div style="max-width:600px;margin:32px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08)">
    <div style="background:#1D4ED8;padding:24px 40px;text-align:center">
      <p style="color:rgba(255,255,255,.7);margin:0 0 4px;font-size:13px">Message about order ${ref}</p>
      <h1 style="color:#fff;margin:0;font-size:20px;font-weight:800">TógBlocks</h1>
    </div>
    <div style="padding:32px 40px">
      <p style="color:#111827;font-size:16px;margin:0 0 20px">Hi ${data.customerName},</p>
      <div style="color:#374151;line-height:1.7;margin:0 0 28px">${bodyHtml}</div>
      <div style="text-align:center;margin:24px 0">
        <a href="https://togblocks.com/orders/${data.orderId}?k=${orderAccessKey(data.orderId)}"
           style="display:inline-block;background:#1D4ED8;color:#fff;text-decoration:none;padding:12px 28px;border-radius:999px;font-weight:700;font-size:14px">
          View your order →
        </a>
      </div>
      <p style="color:#6b7280;font-size:13px">Reply to this email and we'll get back to you. 💚</p>
    </div>
    <div style="background:#f9fafb;padding:16px 40px;text-align:center;font-size:12px;color:#9ca3af">
      TógBlocks · Made in Ireland 🇮🇪
    </div>
  </div>
</body>
</html>`;

  await getTransport().sendMail({
    from: FROM,
    replyTo: 'togblocks@outlook.com',
    to: data.customerEmail,
    subject: data.subject,
    html,
  });
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

export async function sendReviewRequest(data: {
  orderId: number; customerName: string; customerEmail: string; url: string;
}) {
  const ref = `#TB${String(data.orderId).padStart(5, '0')}`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:'Segoe UI',Arial,sans-serif">
  <div style="max-width:600px;margin:32px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08)">
    <div style="background:#1D4ED8;padding:32px 40px;text-align:center">
      <div style="font-size:36px;margin-bottom:8px">📸</div>
      <h1 style="color:#fff;margin:0;font-size:24px;font-weight:800">How did it turn out?</h1>
    </div>
    <div style="padding:32px 40px">
      <p style="color:#111827;font-size:16px;margin:0 0 16px">Hi ${escapeHtml(data.customerName)},</p>
      <p style="color:#374151;line-height:1.6;margin:0 0 16px">
        Your order <strong>${ref}</strong> should have arrived by now. We'd love to know what you think —
        and if you can snap a photo of it in its new home, even better.
      </p>
      <p style="color:#374151;line-height:1.6;margin:0 0 16px">
        We're a tiny family workshop, so every honest review (good or not so good) genuinely helps.
        It takes about a minute.
      </p>
      <div style="text-align:center;margin:32px 0">
        <a href="${data.url}"
           style="display:inline-block;background:#1D4ED8;color:#fff;text-decoration:none;padding:14px 32px;border-radius:999px;font-weight:700;font-size:15px">
          Leave a review →
        </a>
      </div>
      <p style="color:#6b7280;font-size:14px;line-height:1.6">
        Something not right with your order? Just reply to this email and we'll fix it.
      </p>
    </div>
    <div style="background:#f9fafb;padding:20px 40px;text-align:center;font-size:12px;color:#9ca3af">
      TógBlocks · Made in Ireland 🇮🇪
    </div>
  </div>
</body>
</html>`;

  await getTransport().sendMail({
    from: FROM,
    replyTo: 'togblocks@outlook.com',
    to: data.customerEmail,
    subject: `How did your TógBlocks build turn out? (${ref})`,
    html,
  });
}
