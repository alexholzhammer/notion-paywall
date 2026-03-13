const express = require('express');
const fs = require('fs');
const path = require('path');
const { getEmailByToken } = require('../db');
const { getChildPageIds, getFullContent, getPageContent } = require('../notion');

const router = express.Router();

const CACHE_TTL_MS = parseInt(process.env.CONTENT_CACHE_TTL_MS || '300000', 10); // 5 min default

// Per-page content cache: pageId -> { data, time }
const pageCache = new Map();

// Parent page content cache
let parentCache = null;
let parentCacheTime = 0;

// Child page ID cache
let childPageIds = null;
let childPageIdsCacheTime = 0;

async function getCachedChildPageIds() {
  const now = Date.now();
  if (!childPageIds || now - childPageIdsCacheTime > CACHE_TTL_MS) {
    childPageIds = await getChildPageIds();
    childPageIdsCacheTime = now;
  }
  return childPageIds;
}

async function getCachedPageContent(pageId) {
  const now = Date.now();
  const cached = pageCache.get(pageId);
  if (!cached || now - cached.time > CACHE_TTL_MS) {
    const data = await getPageContent(pageId);
    pageCache.set(pageId, { data, time: now });
    return data;
  }
  return cached.data;
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
    const now = Date.now();
    if (!parentCache || now - parentCacheTime > CACHE_TTL_MS) {
      parentCache = await getFullContent();
      parentCacheTime = now;
    }
    const { title, bodyHtml } = parentCache;

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
  pageCache.clear();
  parentCache = null;
  parentCacheTime = 0;
  childPageIds = null;
  childPageIdsCacheTime = 0;
  res.redirect('/content');
});

router.get('/:pageId', authMiddleware, async (req, res, next) => {
  try {
    const rawId = req.params.pageId.replace(/-/g, '');

    const validIds = await getCachedChildPageIds();
    if (!validIds.has(rawId)) {
      return res.status(404).send('<h2>Page not found</h2>');
    }

    const { title, bodyHtml } = await getCachedPageContent(req.params.pageId);

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

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

module.exports = router;
