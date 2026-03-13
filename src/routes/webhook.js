const express = require('express');
const Stripe = require('stripe');
const { addPaidUser } = require('../db');

const router = express.Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

// Raw body is required for Stripe signature verification.
// express.raw() is applied in src/index.js before this router.
router.post('/', (req, res) => {
  const sig = req.headers['stripe-signature'];

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Handle the checkout.session.completed event (fired after payment succeeds)
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;

    if (session.payment_status === 'paid') {
      const email = session.customer_email || session.customer_details?.email;
      if (email) {
        try {
          addPaidUser(email.toLowerCase(), session.id);
          console.log(`Payment recorded for ${email} (session: ${session.id})`);
        } catch (dbErr) {
          console.error('DB error storing paid user:', dbErr.message);
        }
      } else {
        console.warn('No email found in session:', session.id);
      }
    }
  }

  // Also handle async payment success (e.g. bank redirects)
  if (event.type === 'payment_intent.succeeded') {
    const paymentIntent = event.data.object;
    const email = paymentIntent.receipt_email;
    if (email) {
      try {
        addPaidUser(email.toLowerCase(), paymentIntent.id);
        console.log(`Async payment recorded for ${email}`);
      } catch (dbErr) {
        console.error('DB error storing paid user (payment_intent):', dbErr.message);
      }
    }
  }

  res.json({ received: true });
});

module.exports = router;
