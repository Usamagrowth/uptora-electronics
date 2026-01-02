import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { writeClient } from "@/sanity/lib/client";
import { PAYMENT_STATUSES } from "@/lib/orderStatus";

export const POST = async (request: NextRequest) => {
  try {
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const reqBody = await request.json();
    const { orderId, reference, status } = reqBody;

    if (!orderId || !reference) {
      return NextResponse.json(
        { error: "Order ID and payment reference are required" },
        { status: 400 }
      );
    }

    const isPaid = status === "success";

    const updatedOrder = await writeClient
      .patch(orderId)
      .set({
        paymentProvider: "paystack",
        paymentReference: reference,
        paymentStatus: isPaid
          ? PAYMENT_STATUSES.PAID
          : PAYMENT_STATUSES.PENDING,
        paystackStatus: status,
      })
      .commit();

    return NextResponse.json({
      success: true,
      order: updatedOrder,
      message: "Payment status updated successfully",
    });
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    console.error("Paystack payment completion error:", error);
    return NextResponse.json(
      { error: errorMessage || "Failed to update payment status" },
      { status: 500 }
    );
  }
};
