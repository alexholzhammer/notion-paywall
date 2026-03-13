require('dotenv').config();

const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');

const { initDb } = require('./db');
const indexRoute = require('./routes/index');
const checkoutRoute = require('./routes/checkout');
const webhookRoute = require('./routes/webhook');
const successRoute = require('./routes/success');
const contentRoute = require('./routes/content');

const app = express();
const PORT = process.env.PORT || 3000;

// Stripe webhooks need the raw body — mount before express.json()
app.use('/webhook', express.raw({ type: 'application/json' }), webhookRoute);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, '..', 'public')));

app.set('views', path.join(__dirname, '..', 'views'));

app.use('/', indexRoute);
app.use('/checkout', checkoutRoute);
app.use('/success', successRoute);
app.use('/content', contentRoute);

// Generic error handler
app.use((err, req, res, _next) => {
  console.error(err.stack);
  res.status(500).send('<h2>Internal Server Error</h2><p>Please try again later.</p>');
});

initDb();

app.listen(PORT, () => {
  console.log(`Notion paywall running on port ${PORT}`);
});
