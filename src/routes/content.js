const express = require('express');
const fs = require('fs');
const path = require('path');
const { getEmailByToken } = require('../db');
const { getFullContent } = require('../notion');

const router = express.Router();

// Simple in-memory cache to avoid hammering Notion API on every request
let cache = null;
let cacheTime = 0;
const CACHE_TTL_MS = parseInt(process.env.CONTENT_CACHE_TTL_MS || '300000', 10); // 5 min default

async function getCachedContent() {
  const now = Date.now();
  if (!cache || now - cacheTime > CACHE_TTL_MS) {
    cache = await getFullContent();
    cacheTime = now;
  }
  return cache;
}

function authMiddleware(req, res, next) {
  const token = req.cookies && req.cookies.access_token;
  if (!token) {
    return res.redirect('/?error=not_paid');
  }
  const email = getEmailByToken(token);
  if (!email) {
    res.clearCookie('access_token');
    return res.redirect('/?error=invalid_token');
  }
  req.userEmail = email;
  next();
}

router.get('/', authMiddleware, async (req, res, next) => {
  try {
    const { title, bodyHtml } = await getCachedContent();

    const template = fs.readFileSync(
      path.join(__dirname, '..', '..', 'views', 'content.html'),
      'utf8'
    );

    const html = template
      .replace(/{{TITLE}}/g, escapeHtml(title))
      .replace('{{BODY_HTML}}', bodyHtml)
      .replace(/{{EMAIL}}/g, escapeHtml(req.userEmail));

    res.send(html);
  } catch (err) {
    next(err);
  }
});

// Allow users to clear their cache (force refresh from Notion)
router.post('/refresh-cache', authMiddleware, (_req, res) => {
  cache = null;
  cacheTime = 0;
  res.redirect('/content');
});

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

module.exports = router;
