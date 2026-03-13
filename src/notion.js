const { Client } = require('@notionhq/client');
const { marked } = require('marked');

const notion = new Client({ auth: process.env.NOTION_API_KEY });
const PAGE_ID = process.env.NOTION_PAGE_ID;

// Configure marked for safe HTML output
marked.setOptions({ breaks: true });

/**
 * Fetch all blocks for a Notion page recursively (one level of children).
 */
async function fetchBlocks(blockId) {
  const blocks = [];
  let cursor;

  do {
    const response = await notion.blocks.children.list({
      block_id: blockId,
      start_cursor: cursor,
      page_size: 100,
    });

    for (const block of response.results) {
      blocks.push(block);
      // Recurse into blocks that have children (e.g. toggle, column_list)
      if (block.has_children) {
        block.children = await fetchBlocks(block.id);
      }
    }

    cursor = response.next_cursor;
  } while (cursor);

  return blocks;
}

/**
 * Fetch page title from page properties.
 */
async function fetchPageTitle() {
  try {
    const page = await notion.pages.retrieve({ page_id: PAGE_ID });
    const titleProp = Object.values(page.properties).find(
      (p) => p.type === 'title'
    );
    if (titleProp && titleProp.title.length > 0) {
      return titleProp.title.map((t) => t.plain_text).join('');
    }
  } catch {
    // ignore
  }
  return 'Exclusive Content';
}

/**
 * Fetch page title for any page by ID.
 */
async function fetchPageTitleById(pageId) {
  try {
    const page = await notion.pages.retrieve({ page_id: pageId });
    const titleProp = Object.values(page.properties).find(
      (p) => p.type === 'title'
    );
    if (titleProp && titleProp.title.length > 0) {
      return titleProp.title.map((t) => t.plain_text).join('');
    }
  } catch {
    // ignore
  }
  return 'Exclusive Content';
}

/**
 * Return the IDs of all child pages directly under the parent page.
 * IDs are returned as a Set of dash-stripped hex strings for easy lookup.
 */
async function getChildPageIds() {
  const ids = new Set();
  let cursor;

  do {
    const response = await notion.blocks.children.list({
      block_id: PAGE_ID,
      start_cursor: cursor,
      page_size: 100,
    });

    for (const block of response.results) {
      if (block.type === 'child_page') {
        ids.add(block.id.replace(/-/g, ''));
      }
    }

    cursor = response.next_cursor;
  } while (cursor);

  return ids;
}

/**
 * Return all child pages directly under the parent page as { id, title } pairs.
 */
async function getChildPages() {
  const pages = [];
  let cursor;

  do {
    const response = await notion.blocks.children.list({
      block_id: PAGE_ID,
      start_cursor: cursor,
      page_size: 100,
    });

    for (const block of response.results) {
      if (block.type === 'child_page') {
        pages.push({ id: block.id, title: block.child_page.title || 'Untitled' });
      }
    }

    cursor = response.next_cursor;
  } while (cursor);

  return pages;
}

/**
 * Return a specific child page as HTML, fetched by its page ID.
 */
async function getPageContent(pageId) {
  const [title, blocks] = await Promise.all([
    fetchPageTitleById(pageId),
    fetchBlocks(pageId),
  ]);
  const bodyHtml = blocksToHtml(blocks);
  return { title, bodyHtml };
}

/**
 * Convert a single rich-text array to plain text.
 */
function richTextToPlain(richTexts = []) {
  return richTexts.map((t) => t.plain_text).join('');
}

/**
 * Convert a single rich-text array to HTML with inline formatting.
 */
function richTextToHtml(richTexts = []) {
  return richTexts
    .map((t) => {
      let text = escapeHtml(t.plain_text);
      if (t.annotations.bold) text = `<strong>${text}</strong>`;
      if (t.annotations.italic) text = `<em>${text}</em>`;
      if (t.annotations.strikethrough) text = `<s>${text}</s>`;
      if (t.annotations.underline) text = `<u>${text}</u>`;
      if (t.annotations.code) text = `<code>${text}</code>`;
      if (t.href) text = `<a href="${escapeHtml(t.href)}" target="_blank" rel="noopener">${text}</a>`;
      return text;
    })
    .join('');
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Render an array of Notion blocks to an HTML string.
 */
function blocksToHtml(blocks) {
  let html = '';
  let listBuffer = [];
  let listType = null;

  function flushList() {
    if (listBuffer.length === 0) return;
    const tag = listType === 'numbered_list_item' ? 'ol' : 'ul';
    html += `<${tag}>${listBuffer.join('')}</${tag}>`;
    listBuffer = [];
    listType = null;
  }

  for (const block of blocks) {
    const type = block.type;
    const data = block[type] || {};

    // Handle list continuity
    if (type === 'bulleted_list_item' || type === 'numbered_list_item') {
      if (listType && listType !== type) flushList();
      listType = type;
      listBuffer.push(`<li>${richTextToHtml(data.rich_text || [])}</li>`);
      continue;
    } else {
      flushList();
    }

    switch (type) {
      case 'paragraph':
        html += `<p>${richTextToHtml(data.rich_text || [])}</p>`;
        break;
      case 'heading_1':
        html += `<h1>${richTextToHtml(data.rich_text || [])}</h1>`;
        break;
      case 'heading_2':
        html += `<h2>${richTextToHtml(data.rich_text || [])}</h2>`;
        break;
      case 'heading_3':
        html += `<h3>${richTextToHtml(data.rich_text || [])}</h3>`;
        break;
      case 'quote':
        html += `<blockquote>${richTextToHtml(data.rich_text || [])}</blockquote>`;
        break;
      case 'callout': {
        const icon = data.icon?.emoji || 'ℹ️';
        html += `<div class="callout"><span class="callout-icon">${escapeHtml(icon)}</span><div>${richTextToHtml(data.rich_text || [])}</div></div>`;
        break;
      }
      case 'code': {
        const lang = escapeHtml(data.language || '');
        const code = escapeHtml(richTextToPlain(data.rich_text || []));
        html += `<pre><code class="language-${lang}">${code}</code></pre>`;
        break;
      }
      case 'divider':
        html += '<hr>';
        break;
      case 'image': {
        const url = data.type === 'external' ? data.external?.url : data.file?.url;
        const caption = richTextToPlain(data.caption || []);
        if (url) {
          html += `<figure><img src="${escapeHtml(url)}" alt="${escapeHtml(caption)}" loading="lazy"><figcaption>${escapeHtml(caption)}</figcaption></figure>`;
        }
        break;
      }
      case 'toggle':
        html += `<details><summary>${richTextToHtml(data.rich_text || [])}</summary>${block.children ? blocksToHtml(block.children) : ''}</details>`;
        break;
      case 'column_list':
        if (block.children) {
          html += `<div class="column-list">${blocksToHtml(block.children)}</div>`;
        }
        break;
      case 'column':
        if (block.children) {
          html += `<div class="column">${blocksToHtml(block.children)}</div>`;
        }
        break;
      default:
        // Skip unsupported block types silently
        break;
    }
  }

  flushList();
  return html;
}

/**
 * Return the full page as HTML.
 */
async function getFullContent() {
  const [title, blocks] = await Promise.all([fetchPageTitle(), fetchBlocks(PAGE_ID)]);
  const bodyHtml = blocksToHtml(blocks);
  return { title, bodyHtml };
}

/**
 * Return just the first `count` content blocks as an HTML preview string.
 */
async function getPreview(count = 5) {
  const [title, blocks] = await Promise.all([fetchPageTitle(), fetchBlocks(PAGE_ID)]);
  const preview = blocks.slice(0, count);
  const previewHtml = blocksToHtml(preview);
  return { title, previewHtml, totalBlocks: blocks.length };
}

module.exports = { getFullContent, getPreview, getChildPageIds, getChildPages, getPageContent };
