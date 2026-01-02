import crypto from "crypto";
import { NextResponse } from "next/server";
import { backendClient } from "@/sanity/lib/backendClient";
import { ORDER_STATUSES, PAYMENT_STATUSES } from "@/lib/orderStatus";
import { sendOrderStatusNotification } from "@/lib/notificationService";

export async function POST(req: Request) {
  const body = await req.text();
  const signature = req.headers.get("x-paystack-signature");

  const secret = process.env.PAYSTACK_SECRET_KEY;

  if (!signature || !secret) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  // Verify Paystack signature
  const hash = crypto
    .createHmac("sha512", secret)
    .update(body)
    .digest("hex");

  if (hash !== signature) {
    return new NextResponse("Invalid signature", { status: 401 });
  }

  const event = JSON.parse(body);

  // ✅ Paystack success event
  if (event.event === "charge.success") {
    const data = event.data;
    const orderId = data.metadata?.orderId;

    if (!orderId) {
      return new NextResponse("Missing orderId", { status: 400 });
    }

    await handleSuccessfulPayment(orderId, data);
  }

  return NextResponse.json({ received: true });
}

async function handleSuccessfulPayment(orderId: string, data: any) {
  // Fetch current order
  const existingOrder = await backendClient.fetch(
    `*[_type == "order" && _id == $orderId][0]{
      status,
      paymentMethod,
      clerkUserId,
      products,
      user -> {
        clerkUserId
      }
    }`,
    { orderId }
  );

  if (!existingOrder) {
    throw new Error(`Order ${orderId} not found`);
  }

  const updateData: Record<string, unknown> = {
    paymentStatus: PAYMENT_STATUSES.PAID,
    paymentReference: data.reference,
    paymentProvider: "paystack",
    paidAt: new Date(data.paid_at).toISOString(),
  };

  // Order status logic (same as before)
  if (existingOrder.paymentMethod !== "cash_on_delivery") {
    updateData.status = ORDER_STATUSES.PENDING;
  }

  // Update order
  await backendClient.patch(orderId).set(updateData).commit();

  // Update stock
  if (existingOrder.products) {
    await updateStockLevels(existingOrder.products);
  }

  // Notify user
  const userClerkId =
    existingOrder.clerkUserId || existingOrder.user?.clerkUserId;

  if (userClerkId) {
    await sendOrderStatusNotification({
      clerkUserId: userClerkId,
      orderNumber: orderId,
      orderId,
      status: updateData.status as string,
    });
  }
}

// Stock update (unchanged)
async function updateStockLevels(
  orderProducts: Array<{
    product: { _ref: string };
    quantity: number;
  }>
) {
  for (const item of orderProducts) {
    const product = await backendClient.getDocument(item.product._ref);

    if (!product || typeof product.stock !== "number") continue;

    const newStock = Math.max(product.stock - item.quantity, 0);

    await backendClient
      .patch(item.product._ref)
      .set({ stock: newStock })
      .commit();
  }
}
