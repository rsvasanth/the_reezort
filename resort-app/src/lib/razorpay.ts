/**
 * Razorpay Checkout client — loads the standard checkout.js once and opens the
 * modal with a server-created order. The backend signs the order; the client
 * never sees the key_secret. On success the caller hands the {paymentId, signature,
 * amount, orderId} to a backend `capture_*` endpoint which re-verifies the
 * signature before posting any money.
 */

import { FolioApiError } from "@/lib/folio-api";

const CHECKOUT_SRC = "https://checkout.razorpay.com/v1/checkout.js";

type RazorpayOptions = {
	key: string;
	amount: number; // paise
	currency: string;
	order_id: string;
	name: string;
	description?: string;
	prefill?: { name?: string; email?: string; contact?: string };
	theme?: { color?: string };
	handler: (response: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) => void;
	modal?: { ondismiss?: () => void; escape?: boolean };
};

type RazorpayCtor = new (opts: RazorpayOptions) => { open: () => void };

declare global {
	interface Window {
		Razorpay?: RazorpayCtor;
	}
}

let loadingPromise: Promise<void> | null = null;

function loadCheckout(): Promise<void> {
	if (typeof window === "undefined") return Promise.reject(new Error("no window"));
	if (window.Razorpay) return Promise.resolve();
	if (loadingPromise) return loadingPromise;
	loadingPromise = new Promise<void>((resolve, reject) => {
		const script = document.createElement("script");
		script.src = CHECKOUT_SRC;
		script.async = true;
		script.onload = () => resolve();
		script.onerror = () => {
			loadingPromise = null;
			reject(new Error("Could not load Razorpay checkout"));
		};
		document.head.appendChild(script);
	});
	return loadingPromise;
}

export type RazorpayOrder = {
	order_id: string;
	amount: number; // paise
	currency: string;
	key_id: string;
	guest_folio?: string;
};

export type RazorpayPaymentResult = {
	order_id: string;
	payment_id: string;
	signature: string;
	amount: number; // paise
	currency: string;
};

/**
 * Opens the Razorpay modal for an already-created order and resolves with the
 * verified-on-server payment details. Rejects if the guest closes the modal.
 */
export async function openRazorpayCheckout(input: {
	order: RazorpayOrder;
	guestName?: string;
	guestEmail?: string | null;
	guestPhone?: string | null;
	description?: string;
}): Promise<RazorpayPaymentResult> {
	await loadCheckout();
	if (!window.Razorpay) {
		throw new FolioApiError("Razorpay failed to initialise", { status: 500 });
	}
	return new Promise<RazorpayPaymentResult>((resolve, reject) => {
		const rz = new window.Razorpay!({
			key: input.order.key_id,
			amount: input.order.amount,
			currency: input.order.currency,
			order_id: input.order.order_id,
			name: "THE REEZORT",
			description: input.description ?? "Folio payment",
			prefill: {
				name: input.guestName,
				email: input.guestEmail ?? undefined,
				contact: input.guestPhone ?? undefined,
			},
			theme: { color: "#0f172a" },
			handler: (response) => {
				resolve({
					order_id: response.razorpay_order_id,
					payment_id: response.razorpay_payment_id,
					signature: response.razorpay_signature,
					amount: input.order.amount,
					currency: input.order.currency,
				});
			},
			modal: {
				ondismiss: () => reject(new FolioApiError("Payment cancelled", { status: 499 })),
				escape: true,
			},
		});
		rz.open();
	});
}
