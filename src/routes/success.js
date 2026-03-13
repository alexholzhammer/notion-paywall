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

router.get('/', async (req, res, next) => {
  try {
    const { session_id } = req.query;

    if (!session_id) {
      return res.redirect('/');
    }

    // Retrieve and verify the Checkout Session with Stripe
    const session = await stripe.checkout.sessions.retrieve(session_id);

    if (session.payment_status !== 'paid') {
      return res.redirect('/');
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
