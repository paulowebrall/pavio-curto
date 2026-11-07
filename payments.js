// Pix pelo Mercado Pago (se MP_ACCESS_TOKEN estiver configurado). Sem ele, as doações são confirmadas à mão pelo organizador.
const https = require('https');

const TOKEN = () => process.env.MP_ACCESS_TOKEN;
const enabled = () => !!TOKEN();

function mp(method, path, body, idem) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = https.request({
      host: 'api.mercadopago.com', path, method,
      headers: Object.assign({ Authorization: 'Bearer ' + TOKEN(), 'Content-Type': 'application/json' },
        idem ? { 'X-Idempotency-Key': idem } : {}, data ? { 'Content-Length': Buffer.byteLength(data) } : {})
    }, res => {
      let s = ''; res.on('data', c => s += c);
      res.on('end', () => {
        let j = {}; try { j = JSON.parse(s); } catch (e) {}
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(j);
        else reject(new Error(j.message || ('Mercado Pago respondeu ' + res.statusCode)));
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => req.destroy(new Error('Mercado Pago não respondeu')));
    if (data) req.write(data);
    req.end();
  });
}

async function createPix({ amountCents, email, description, ref }) {
  const j = await mp('POST', '/v1/payments', {
    transaction_amount: amountCents / 100, description, payment_method_id: 'pix',
    payer: { email }, external_reference: ref
  }, ref);
  const t = (j.point_of_interaction && j.point_of_interaction.transaction_data) || {};
  return { mpId: String(j.id), qr: t.qr_code || '', qrImg: t.qr_code_base64 || '', status: j.status };
}
async function pixStatus(mpId) { const j = await mp('GET', '/v1/payments/' + encodeURIComponent(mpId)); return j.status; }

module.exports = { enabled, createPix, pixStatus };
