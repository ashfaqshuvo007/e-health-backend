import {
	AppointmentStatus,
	PaymentStatus,
} from "../../../generated/prisma/enums";
import config from "../../config";
import { BkashConfig } from "../../lib/bkash";
import { prisma } from "../../lib/prisma";
import { RequestUser } from "../../middleware/checkAuth";

const BKASH_BASE_URL = config.bkash_base_url;
const BKASH_APP_KEY = config.bkash_app_key;
const BKASH_PAYMENT_CALLBACK_URL = `${config.bkash_callback_url}/appointment/book-appointment/payment/callback`;

const bookAppointment = async (payload: any, user: RequestUser) => {
	const transactionResult = await prisma.$transaction(async (tx) => {
		// Create Appointment
		const appointment = await tx.appointment.create({
			data: {
				status: AppointmentStatus.PENDING,
			},
		});

		const bkashIdToken = await BkashConfig.getBkashIdToken();

		if (!bkashIdToken) {
			throw new Error("Bkash Access Token Not Found.");
		}

		const createBkashPaymentResponse = await fetch(
			`${BKASH_BASE_URL}/tokenized/checkout/create`,
			{
				method: "POST",
				headers: {
					Host: BKASH_BASE_URL,
					"Content-Type": "application/json",
					Accept: "application/json",
					Authorization: bkashIdToken,
					"X-app-key": BKASH_APP_KEY,
				},
				body: JSON.stringify({
					// agreementID: "TokenizedMerchant01L3IKB6H1565072174986", //appointment ID
					mode: "0011",
					// payerReference: "01723888888", // Use email or phone number.
					payerReference: user.email, // Use email or phone number.
					callbackURL: BKASH_PAYMENT_CALLBACK_URL,
					amount: "1200",
					currency: "BDT",
					intent: "sale",
					// merchantInvoiceNumber: "Inv1", // appointment ID
					merchantInvoiceNumber: appointment.id, // appointment ID
				}),
			},
		);

		const createBkashPaymentResult = await createBkashPaymentResponse.json();

		//Payment Model Create
		await tx.payment.create({
			data: {
				merchantInvoiceNumber: createBkashPaymentResult.merchantInvoiceNumber,
				appointmentId: appointment.id,
				amount: "1200",
				gatewayResponse: createBkashPaymentResult,
				bkashPaymentId: createBkashPaymentResult.paymentID,
				payerReference: user.email,
			},
		});
		return {
			payemntUrl: createBkashPaymentResult.bkashURL,
		};
	});
	return transactionResult;
};

const payAppointment = async (payload: any, user: RequestUser) => {
	const appointmentId = payload.appointmentId;

	const existingAppointment = await prisma.appointment.findUnique({
		where: {
			id: appointmentId,
		},
	});

	if (!existingAppointment) {
		throw new Error("Appointment Does Not Exist.");
	}

	if (existingAppointment.status !== "PENDING") {
		throw new Error("Appointment Is Not Pending.");
	}

	//Try Payment
	const bkashIdToken = await BkashConfig.getBkashIdToken();

	if (!bkashIdToken) {
		throw new Error("Bkash Access Token Not Found.");
	}

	const createBkashPaymentResponse = await fetch(
		`${BKASH_BASE_URL}/tokenized/checkout/create`,
		{
			method: "POST",
			headers: {
				Host: BKASH_BASE_URL,
				"Content-Type": "application/json",
				Accept: "application/json",
				Authorization: bkashIdToken,
				"X-app-key": BKASH_APP_KEY,
			},
			body: JSON.stringify({
				// agreementID: "TokenizedMerchant01L3IKB6H1565072174986", //appointment ID
				mode: "0011",
				// payerReference: "01723888888", // Use email or phone number.
				payerReference: user.email, // Use email or phone number.
				callbackURL: BKASH_PAYMENT_CALLBACK_URL,
				amount: "1200",
				currency: "BDT",
				intent: "sale",
				// merchantInvoiceNumber: "Inv1", // appointment ID
				merchantInvoiceNumber: existingAppointment.id, // appointment ID
			}),
		},
	);

	const createBkashPaymentResult = await createBkashPaymentResponse.json();

	//Payment Model Create
	await prisma.payment.update({
		where: {
			appointmentId: existingAppointment.id,
		},
		data: {
			merchantInvoiceNumber: createBkashPaymentResult.merchantInvoiceNumber,
			gatewayResponse: createBkashPaymentResult,
			bkashPaymentId: createBkashPaymentResult.paymentID,
			payerReference: user.email,
		},
	});
	return {
		payemntUrl: createBkashPaymentResult.bkashURL,
	};
};

const bookAppointmentCallback = async (query: Record<string, any>) => {
	const transactionResult = await prisma.$transaction(async (tx) => {
		const paymentId = query.paymentID;
		const status = query.status;

		if (!paymentId) {
			throw new Error("Payment ID Missing.");
		}

		if (!status) {
			throw new Error("Payment Status Missing.");
		}

		const bkashIdToken = await BkashConfig.getBkashIdToken();
		if (!bkashIdToken) {
			throw new Error("Bkash Access Token Not Found.");
		}

		const executePaymentResponse = await fetch(
			`${BKASH_BASE_URL}/tokenized/checkout/execute`,
			{
				method: "POST",
				headers: {
					Host: BKASH_BASE_URL,
					"Content-Type": "application/json",
					Accept: "application/json",
					authorization: bkashIdToken,
					"X-app-key": BKASH_APP_KEY,
				},
				body: JSON.stringify({
					paymentID: paymentId,
				}),
			},
		);
		const executedPaymentResult = await executePaymentResponse.json();

		if (status === "success") {
			await tx.appointment.update({
				where: {
					id: executedPaymentResult.merchantInvoiceNumber,
				},
				data: {
					status: AppointmentStatus.CONFIRMED,
				},
			});

			await tx.payment.update({
				where: {
					bkashPaymentId: paymentId,
				},
				data: {
					status: PaymentStatus.PAID,
					bkashTrxID: executedPaymentResult.trxID,
					paidAt: executedPaymentResult.paymentExecuteTime,
					gatewayResponse: executedPaymentResult,
				},
			});
			return {
				executedPaymentResult,
				redirectUrl: `${config.frontend_url}/dashboard/my-appointments?status=success`,
			};
		}

		if (status === "failure") {
			await tx.payment.update({
				where: {
					bkashPaymentId: paymentId,
				},
				data: {
					status: PaymentStatus.FAILED,
					gatewayResponse: executedPaymentResult,
				},
			});
			return {
				redirectUrl: `${config.frontend_url}/dashboard/my-appointments?status=failure`,
			};
		}

		if (status === "cancel") {
			await tx.payment.update({
				where: {
					bkashPaymentId: paymentId,
				},
				data: {
					status: PaymentStatus.CANCELLED,
					gatewayResponse: executedPaymentResult,
				},
			});
			return {
				executedPaymentResult,
				redirectUrl: `${config.frontend_url}/dashboard/my-appointments?status=cancel`,
			};
		}

		return {
			executedPaymentResult,
			redirectUrl: `${config.frontend_url}/dashboard/my-appointments?error=payment-failed`,
		};
	});

	return transactionResult;
};

const cancelAppointment = async (payload: any) => {
	const cancelTransaction = await prisma.$transaction(async (tx) => {
		const appointmentId = payload.appointmentId;

		const existingAppointment = await tx.appointment.findUnique({
			where: {
				id: appointmentId,
			},
			include: {
				payment: true,
			},
		});

		if (!existingAppointment) {
			throw new Error("Appointment Does Not Exist.");
		}

		if (
			existingAppointment.status === "ONGOING" ||
			existingAppointment.status === "COMPLETED"
		) {
			throw new Error("Appointment Is Ongoing or Completed.");
		}

		if (existingAppointment.status === "CANCELLED") {
			throw new Error("Appointment Already Cancelled.");
		}

		const updatedAppointment = await tx.appointment.update({
			where: {
				id: existingAppointment.id,
			},
			data: {
				status: AppointmentStatus.CANCELLED,
			},
		});

		// Bkash Refund Process
		const bkashIdToken = await BkashConfig.getBkashIdToken();

		if (!bkashIdToken) {
			throw new Error("Bkash Access Token Not Found.");
		}

		const bkashRefundResponse = await fetch(
			`${BKASH_BASE_URL}/v2/tokenized-checkout/refund/payment/transaction`,
			{
				method: "POST",
				headers: {
					Host: BKASH_BASE_URL,
					"Content-Type": "application/json",
					Accept: "application/json",
					Authorization: bkashIdToken,
					"X-app-key": BKASH_APP_KEY,
				},
				body: JSON.stringify({
					paymentId: existingAppointment.payment?.bkashPaymentId,
					trxId: existingAppointment.payment?.bkashTrxID,
					refundAmount: existingAppointment.payment?.amount,
					sku: "Appointment Cancelation",
					reason: "Patient Cancelled Apointment",
				}),
			},
		);

		const bkashRefundResult = await bkashRefundResponse.json();

		//Update payment in DB after Refund
		const updatedPayment = await tx.payment.update({
			where: {
				id: existingAppointment.id,
			},
			data: {
				refundTrxId: bkashRefundResult.refundTrxId,
				refundedAt: bkashRefundResult.completedTimne,
				refundAmount: bkashRefundResult.refundAmount,
				refundReason: bkashRefundResult.reason,
				status: PaymentStatus.REFUNDED,
				gatewayResponse: bkashRefundResult,
			},
		});

		return {
			appointment: updatedAppointment,
			payment: updatedPayment,
		};
	});

	return cancelTransaction;
};

export const AppointmentService = {
	bookAppointment,
	payAppointment,
	bookAppointmentCallback,
	cancelAppointment,
};
