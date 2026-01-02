import { NextRequest, NextResponse } from "next/server";

export const POST = async (req: NextRequest) => {
  try {
    const { email, amount, orderId } = await req.json();

    const res = await fetch("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email,
        amount: amount * 100, // Paystack uses kobo
        metadata: {
          orderId,
        },
        callback_url: `${process.env.NEXT_PUBLIC_BASE_URL}/payment/success`,
      }),
    });

    const data = await res.json();

    if (!data.status) {
      return NextResponse.json(
        { error: data.message },
        { status: 400 }
      );
    }

    return NextResponse.json({
      authorizationUrl: data.data.authorization_url,
      reference: data.data.reference,
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: "Failed to initialize payment" },
      { status: 500 }
    );
  }
};
