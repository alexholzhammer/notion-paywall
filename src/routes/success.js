const express = require('express');
const Stripe = require('stripe');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
const { isPaidEmail, saveAccessToken, addPaidUser } = require('../db');

const router = express.Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// 30-day cookie
const COOKIE_MAX_AGE = 30 * 24 * 60 * 60 * 1000;

const POLL_ATTEMPTS = 3;
const POLL_DELAY_MS = 1000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retrieve a Checkout Session from Stripe, retrying up to POLL_ATTEMPTS times
 * (with POLL_DELAY_MS between each) until payment_status is 'paid'.
 * Returns the session once paid, or null if all attempts are exhausted.
 */
async function retrievePaidSession(sessionId) {
  for (let attempt = 1; attempt <= POLL_ATTEMPTS; attempt++) {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (session.payment_status === 'paid') {
      return session;
    }
    if (attempt < POLL_ATTEMPTS) {
      await sleep(POLL_DELAY_MS);
    }
  }
  return null;
}

router.get('/', async (req, res, next) => {
  try {
    const { session_id } = req.query;

    if (!session_id) {
      return res.redirect('/');
    }

    // Retrieve and verify the Checkout Session, retrying to handle the race
    // condition where Stripe hasn't yet marked the session as paid by the time
    // the browser lands on /success.
    const session = await retrievePaidSession(session_id);

    if (!session) {
      return res.status(402).send(
        '<p>Payment not confirmed yet. Please wait a moment and ' +
        '<a href="/success?session_id=' + encodeURIComponent(session_id) + '">try again</a>, ' +
        'or contact <a href="mailto:support@automatisierer.io">support@automatisierer.io</a>.</p>'
      );
    }

    const email = (
      session.customer_email ||
      session.customer_details?.email ||
      ''
    ).toLowerCase();

    if (!email) {
      return res.status(400).send('<p>Could not determine your email. Please contact support.</p>');
    }

    // Ensure the user exists in DB (webhook may arrive slightly later)
    if (!isPaidEmail(email)) {
      addPaidUser(email, session.id);
    }

    // Generate a durable access token and set as cookie
    const token = uuidv4();
    saveAccessToken(token, email);

    res.cookie('access_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: COOKIE_MAX_AGE,
    });

    const template = fs.readFileSync(
      path.join(__dirname, '..', '..', 'views', 'success.html'),
      'utf8'
    );

    const html = template.replace(/{{EMAIL}}/g, escapeHtml(email));
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
