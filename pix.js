// Pix copia e cola (BR Code estático, padrão do Banco Central) com a chave do organizador.
// A pessoa paga pelo app do banco lendo o QR Code; o organizador confirma a doação no painel.
const QRCode = require('qrcode');

// campo EMV: id (2 dígitos) + tamanho (2 dígitos) + valor
const f = (id, v) => id + String(v.length).padStart(2, '0') + v;
// sem acento e só caracteres aceitos, como os bancos esperam
const clean = (s, max) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9 .@_\-+]/g, '').trim().toUpperCase().slice(0, max);

// CRC16-CCITT (polinômio 0x1021, começa em 0xFFFF), exigido no fim do código
function crc16(s) {
  let c = 0xFFFF;
  for (let i = 0; i < s.length; i++) {
    c ^= s.charCodeAt(i) << 8;
    for (let k = 0; k < 8; k++) c = c & 0x8000 ? ((c << 1) ^ 0x1021) & 0xFFFF : (c << 1) & 0xFFFF;
  }
  return c.toString(16).toUpperCase().padStart(4, '0');
}

function brCode({ key, name, city, amountCents, txid }) {
  const gui = f('00', 'br.gov.bcb.pix') + f('01', String(key).trim());
  const tx = String(txid || '***').replace(/[^A-Za-z0-9]/g, '').slice(0, 25) || '***';
  const body = f('00', '01') + f('26', gui) + f('52', '0000') + f('53', '986') +
    (amountCents ? f('54', (amountCents / 100).toFixed(2)) : '') + f('58', 'BR') +
    f('59', clean(name, 25) || 'PAVIO CURTO') + f('60', clean(city, 15) || 'BRASIL') + f('62', f('05', tx)) + '6304';
  return body + crc16(body);
}

// devolve o código e a imagem do QR (PNG em base64)
async function pixQr(opts) {
  const code = brCode(opts);
  const url = await QRCode.toDataURL(code, { margin: 1, width: 320, errorCorrectionLevel: 'M' });
  return { code, img: url.replace(/^data:image\/png;base64,/, '') };
}

module.exports = { brCode, pixQr, crc16 };
