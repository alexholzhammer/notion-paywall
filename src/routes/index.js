const express = require('express');
const fs = require('fs');
const path = require('path');
const { getPreview } = require('../notion');
const { getEmailByToken } = require('../db');

const router = express.Router();
const PREVIEW_BLOCKS = parseInt(process.env.PREVIEW_BLOCKS || '5', 10);

router.get('/', async (req, res, next) => {
  try {
    // If visitor already has a valid token, redirect to content
    const token = req.cookies && req.cookies.access_token;
    if (token) {
      const email = getEmailByToken(token);
      if (email) return res.redirect('/content');
    }

    const { title, previewHtml, totalBlocks } = await getPreview(PREVIEW_BLOCKS);
    const template = fs.readFileSync(
      path.join(__dirname, '..', '..', 'views', 'landing.html'),
      'utf8'
    );

    const price = process.env.STRIPE_PRICE_DISPLAY || '€9.99';
    const productName = process.env.PRODUCT_NAME || title;

    const html = template
      .replace(/{{TITLE}}/g, escapeHtml(title))
      .replace(/{{PRODUCT_NAME}}/g, escapeHtml(productName))
      .replace('{{PREVIEW_HTML}}', previewHtml)
      .replace('{{PRICE}}', escapeHtml(price))
      .replace('{{HIDDEN_COUNT}}', String(Math.max(0, totalBlocks - PREVIEW_BLOCKS)));

    res.send(html);
  } catch (err) {
    next(err);
  }
});

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

module.exports = router;
