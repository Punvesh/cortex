import { processPayment as pay, PaymentResult as Result } from "./payments.js";
import * as Stripe from "./stripe.js";

export async function checkout(amount: number): Promise<Result> {
  Stripe.init();
  return pay(amount);
}
