import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@clerk/nextjs/server";
import { writeClient } from "@/sanity/lib/client";
import { PAYMENT_STATUSES } from "@/lib/orderStatus";

export async function POST(
  request: NextRequest,
  { params }: { params: { orderId: string } }
) {
  try {
    /* -------------------- AUTH -------------------- */
    const user = await currentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { orderId } = params;
    if (!orderId) {
      return NextResponse.json(
        { error: "Order ID is required" },
        { status: 400 }
      );
    }

    /* -------------------- FETCH ORDER -------------------- */
    const order = await writeClient.fetch(
      `*[_type == "order" && _id == $orderId && clerkUserId == $userId][0]{
        _id,
        orderNumber,
        clerkUserId,
        customerName,
        email,
        products[]{
          product->{
            _id,
            name,
            price,
            currency
          },
          quantity
        },
        subtotal,
        tax,
        shipping,
        totalPrice,
        currency,
        paymentStatus,
        paymentReference,
        invoice
      }`,
      { orderId, userId: user.id }
    );

    if (!order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    /* -------------------- PAID CHECK -------------------- */
    if (order.paymentStatus !== PAYMENT_STATUSES.PAID) {
      return NextResponse.json(
        { error: "Invoice can only be generated for paid orders" },
        { status: 400 }
      );
    }

    /* -------------------- ALREADY EXISTS -------------------- */
    if (order.invoice?.number) {
      return NextResponse.json(
        {
          success: true,
          invoice: order.invoice,
          message: "Invoice already exists",
        },
        { status: 200 }
      );
    }

    /* -------------------- CREATE INVOICE -------------------- */
    const invoiceNumber = `INV-${order.orderNumber || order._id.slice(-6)}`;

    const invoice = {
      number: invoiceNumber,
      provider: "paystack",
      reference: order.paymentReference,
      currency: order.currency || "NGN",
      subtotal: order.subtotal || 0,
      tax: order.tax || 0,
      shipping: order.shipping || 0,
      total: order.totalPrice,
      customer: {
        name: order.customerName,
        email: order.email,
      },
      items: order.products.map((item: any) => ({
        productId: item.product?._id,
        name: item.product?.name,
        quantity: item.quantity,
        unitPrice: item.product?.price,
        total: item.product?.price * item.quantity,
      })),
      generatedAt: new Date().toISOString(),
    };

    /* -------------------- SAVE TO SANITY -------------------- */
    await writeClient
      .patch(order._id)
      .set({ invoice })
      .commit();

    /* -------------------- RESPONSE -------------------- */
    return NextResponse.json(
      {
        success: true,
        invoice,
        message: "Invoice generated successfully",
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("Invoice generation error:", error);
    return NextResponse.json(
      { error: "Failed to generate invoice" },
      { status: 500 }
    );
  }
}
