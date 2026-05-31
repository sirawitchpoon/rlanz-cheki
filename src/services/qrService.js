'use strict';

// Generates a PromptPay QR PNG with the exact amount embedded, fully offline
// and free. The buyer scans it and the amount is pre-filled in their bank app.
//
// promptpay-qr builds the EMVCo payload string from the merchant's PromptPay id
// (a phone number or 13-digit national id) and an amount; qrcode renders it.
const generatePayload = require('promptpay-qr');
const QRCode = require('qrcode');

// satang -> number of THB with 2 decimals (e.g. 34900 -> 349.00)
function satangToBaht(satang) {
  return Math.round(satang) / 100;
}

// Returns a PNG Buffer for the given PromptPay id and amount in satang.
async function generate(promptpayId, amountSatang) {
  if (!promptpayId) throw new Error('PromptPay id is not configured');
  const amount = satangToBaht(amountSatang);
  const payload = generatePayload(String(promptpayId), { amount });
  return QRCode.toBuffer(payload, {
    type: 'png',
    errorCorrectionLevel: 'M',
    margin: 2,
    width: 512,
  });
}

module.exports = { generate, satangToBaht };
