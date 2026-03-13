const express = require('express');
const Stripe = require('stripe');

const router = express.Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const BASE_URL = process.env.BASE_URL || 'https://paywall.automatisierer.io';

router.post('/', async (req, res, next) => {
  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [
        {
          price: process.env.STRIPE_PRICE_ID,
          quantity: 1,
        },
      ],
      // Ask for email so we can identify the buyer in the webhook
      customer_email: req.body.email || undefined,
      success_url: `${BASE_URL}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${BASE_URL}/`,
    });

    res.redirect(303, session.url);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
