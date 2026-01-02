import Stripe from "stripe";

if (!process.env.PAYSTACK_SECRET_KEY) {
  throw new Error("STRIPE_SCERET_KEY is not set");
}

const paystack = new Stripe(process.env.STRIPE_SECRET_KEY as string, {
  apiVersion: "2025-10-29.clover",
});

export default paystack;
