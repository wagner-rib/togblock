import nodemailer from 'nodemailer';

function getTransport() {
  return nodemailer.createTransport({
    host: import.meta.env.SMTP_HOST,
    port: Number(import.meta.env.SMTP_PORT ?? 587),
    secure: false, // STARTTLS
    auth: {
      user: import.meta.env.SMTP_USER,
      pass: import.meta.env.SMTP_PASS,
    },
    tls: { rejectUnauthorized: false },
  });
}

const FROM = import.meta.env.SMTP_FROM ?? import.meta.env.SMTP_USER;

interface OrderItem {
  product_type: string;
  custom_name: string;
  quantity: number;
  unit_price: number;
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

function itemRows(items: OrderItem[]) {
  return items.map(item => `
    <tr>
      <td style="padding:10px 0;border-bottom:1px solid #e5e7eb">
        <strong>${item.product_type === 'door-sign' ? 'Door Sign' : 'Brick Letters'}</strong><br>
        <span style="color:#6b7280;font-size:14px">Name: ${item.custom_name}</span>
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
        <a href="https://togblocks.com/orders/${data.orderId}"
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
        <a href="https://togblocks.com/orders/${data.orderId}"
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
        <a href="https://togblocks.com/orders/${data.orderId}"
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
