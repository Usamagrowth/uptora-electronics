import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { writeClient, client } from "@/sanity/lib/client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(req: NextRequest) {
  try {
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { orderId } = await req.json();

    if (!orderId) {
      return NextResponse.json(
        { error: "Order ID is required" },
        { status: 400 }
      );
    }

    // Fetch order
    const order = await client.fetch(
      `*[_type == "order" && _id == $orderId][0]{
        _id,
        orderNumber,
        totalPrice,
        paymentMethod,
        paymentStatus,
        status,
        paystackReference,
        clerkUserId
      }`,
      { orderId }
    );

    if (!order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    if (order.clerkUserId !== userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    if (order.status === "cancelled") {
      return NextResponse.json(
        { error: "Order already cancelled" },
        { status: 400 }
      );
    }

    if (["delivered", "completed"].includes(order.status)) {
      return NextResponse.json(
        { error: "Cannot cancel delivered or completed orders" },
        { status: 400 }
      );
    }

    let refundAmount = 0;
    let paystackRefundId: string | null = null;

    // ✅ PAYSTACK REFUND
    if (
      order.paymentMethod === "paystack" &&
      order.paymentStatus === "paid" &&
      order.paystackReference
    ) {
      try {
        const response = await fetch("https://api.paystack.co/refund", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            transaction: order.paystackReference,
            amount: Math.round((order.totalPrice || 0) * 100), // kobo
          }),
        });

        const result = await response.json();

        if (!result.status) {
          throw new Error(result.message);
        }

        paystackRefundId = result.data.id;
        refundAmount = order.totalPrice || 0;

        console.log("Paystack refund successful:", paystackRefundId);
      } catch (err) {
        console.error("Paystack refund failed, refunding to wallet:", err);
        refundAmount = order.totalPrice || 0;
      }
    }

    // Cancel order
    await writeClient
      .patch(orderId)
      .set({
        status: "cancelled",
        cancelledAt: new Date().toISOString(),
        cancelledBy: userId,
        paystackRefundId: paystackRefundId || undefined,
      })
      .commit();

    // Wallet refund fallback
    if (refundAmount > 0) {
      const user = await client.fetch(
        `*[_type == "user" && clerkUserId == $userId][0]{
          _id,
          walletBalance
        }`,
        { userId }
      );

      if (user) {
        const currentBalance = user.walletBalance || 0;
        const newBalance = currentBalance + refundAmount;

        const transaction = {
          id: `TXN-${Date.now()}`,
          type: "credit_refund",
          amount: refundAmount,
          balanceBefore: currentBalance,
          balanceAfter: newBalance,
          description: `Refund for cancelled order #${order.orderNumber}`,
          orderId: order._id,
          createdAt: new Date().toISOString(),
          status: "completed",
          processedBy: "system",
        };

        await writeClient
          .patch(user._id)
          .set({ walletBalance: newBalance })
          .setIfMissing({ walletTransactions: [] })
          .append("walletTransactions", [transaction])
          .commit();
      }
    }

    return NextResponse.json({
      success: true,
      message: "Order cancelled successfully",
      refundAmount,
      refundedToWallet: refundAmount > 0,
    });
  } catch (error) {
    console.error("Refund error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
