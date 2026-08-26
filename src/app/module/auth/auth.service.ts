/** biome-ignore-all lint/style/useConst: <explanation> */

import crypto from "node:crypto";
import path from "node:path";
import bcrypt from "bcryptjs";
import ejs from "ejs";
import type { TokenPayload } from "google-auth-library";
import type { JwtPayload, SignOptions } from "jsonwebtoken";
import {
	AuthProvider,
	Role,
	UserStatus,
} from "../../../generated/prisma/enums";
import config from "../../config";
import { googleClient } from "../../lib/google";
import { transporter } from "../../lib/nodemailer";
import { prisma } from "../../lib/prisma";
import { redisClient } from "../../lib/redis";
import { jwtUtils } from "../../utils/jwt";
import type {
	IForgotPasswordPayload,
	IGoogleLoginPayload,
	ILoginUserPayload,
	IRegisterPatientPayload,
	IRequestUser,
	IResetPasswordPayload,
	IVerfiyUserEmailPayload,
} from "./auth.interface";

const registerPatient = async (payload: IRegisterPatientPayload) => {
	const { name, password, patient: patientData } = payload;
	const email = payload.email.trim().toLowerCase();

	const isUserExists = await prisma.user.findUnique({
		where: { email },
	});

	if (isUserExists) {
		throw new Error("User with this email already exists");
	}

	const hashedPassword = await bcrypt.hash(
		password,
		Number(config.bcrypt_salt_rounds),
	);

	// Store User Data in Redis

	const otp = crypto.randomInt(100000, 1000000).toString();
	const otpKey = `patient-registration-otp:${email}`;
	await redisClient.set(otpKey, otp, {
		expiration: {
			type: "EX",
			value: 5 * 60,
		},
	});

	const patientRegistrationKey = `patient-registration-data:${email}`;
	const redisUserDataPayload = {
		name,
		email,
		password: hashedPassword,
		patient: patientData,
	};
	await redisClient.set(
		patientRegistrationKey,
		JSON.stringify(redisUserDataPayload),
		{
			expiration: {
				type: "EX",
				value: 5 * 60,
			},
		},
	);

	const templatePath = path.join(
		process.cwd(),
		"src/app/templates/user-registration-otp.ejs",
	);
	const html = await ejs.renderFile(templatePath, {
		name: name,
		otp: otp,
		expiration: 5,
	});

	await transporter.sendMail(
		{
			from: config.email_sender,
			to: email,
			subject: "Email Verification",
			html: html,
		},
		(error, info) => {
			if (error) {
				console.log("Error Sending Registration OTP Email: ", error);
			}
			console.log("Email sent: %s", info.messageId);
		},
	);
};

const loginUser = async (payload: ILoginUserPayload) => {
	const { password } = payload;
	const email = payload.email.trim().toLowerCase();

	const user = await prisma.user.findUnique({
		where: { email },
	});

	if (!user) {
		throw new Error("User not found");
	}

	if (user.status === UserStatus.BLOCKED) {
		throw new Error("User is blocked");
	}

	if (user.isDeleted || user.status === UserStatus.DELETED) {
		throw new Error("User is deleted");
	}

	if (user.password === null && user.googleId !== null) {
		throw new Error(
			"User is already registered using google. Try Google login.",
		);
	}

	const isPasswordMatched = await bcrypt.compare(
		password,
		user.password as string,
	);

	if (!isPasswordMatched) {
		throw new Error("Invalid credentials");
	}

	const jwtPayload = {
		userId: user.id,
		name: user.name,
		email: user.email,
		role: user.role,
	};

	const accessToken = jwtUtils.createToken(
		jwtPayload,
		config.jwt_access_secret,
		config.jwt_access_expires_in as SignOptions,
	);

	const refreshToken = jwtUtils.createToken(
		jwtPayload,
		config.jwt_refresh_secret,
		config.jwt_refresh_expires_in as SignOptions,
	);

	return {
		accessToken,
		refreshToken,
	};
};

const getMe = async (user: IRequestUser) => {
	const isUserExists = await prisma.user.findUnique({
		where: {
			id: user.userId,
		},
		include: {
			patient: true,
		},
		omit: {
			password: true,
		},
	});

	if (!isUserExists) {
		throw new Error("User not found");
	}

	return isUserExists;
};

const refreshToken = async (token: string) => {
	const verifiedRefreshToken = jwtUtils.verifyToken(
		token,
		config.jwt_refresh_secret,
	);

	if (!verifiedRefreshToken.success || !verifiedRefreshToken.data) {
		throw new Error(
			config.node_env === "development"
				? verifiedRefreshToken.error
				: "Invalid refresh token",
		);
	}

	const data = verifiedRefreshToken.data as JwtPayload;

	const user = await prisma.user.findUnique({
		where: { id: data.userId },
	});

	if (!user || user.isDeleted || user.status !== UserStatus.ACTIVE) {
		throw new Error("User is inactive or not found");
	}

	const jwtPayload = {
		userId: user.id,
		name: user.name,
		email: user.email,
		role: user.role,
	};

	const accessToken = jwtUtils.createToken(
		jwtPayload,
		config.jwt_access_secret,
		config.jwt_access_expires_in as SignOptions,
	);

	const refreshToken = jwtUtils.createToken(
		jwtPayload,
		config.jwt_refresh_secret,
		config.jwt_refresh_expires_in as SignOptions,
	);

	return {
		accessToken,
		refreshToken,
	};
};

const gogleAuth = async (payload: IGoogleLoginPayload) => {
	let googleIdTokenPayload: TokenPayload | null | undefined = null;

	// Get User details from google
	try {
		const ticket = await googleClient.verifyIdToken({
			idToken: payload.idToken,
			audience: config.google_client_id,
		});

		googleIdTokenPayload = ticket.getPayload();
	} catch (error) {
		console.log("Google ID Token Verificaton Failed", error);
		throw new Error("Invalid Or Expired Google Id Token");
	}

	// User details from google FAILED
	if (!googleIdTokenPayload) {
		throw new Error("Invalid Or Expired Google Id Token");
	}
	if (!googleIdTokenPayload.email) {
		throw new Error("Google User Not Found");
	}

	if (!googleIdTokenPayload.name) {
		throw new Error("Google Name Not Found");
	}

	// User details from google SUCCESS
	const ifPAtientExistsWithGoogleAuth = await prisma.user.findUnique({
		where: {
			email: googleIdTokenPayload.email,
			role: Role.PATIENT,
			googleId: googleIdTokenPayload.sub,
		},
	});

	let user = ifPAtientExistsWithGoogleAuth;

	if (!ifPAtientExistsWithGoogleAuth) {
		const ifPatientExistWithCredentials = await prisma.user.findUnique({
			where: {
				email: googleIdTokenPayload.email,
				role: Role.PATIENT,
				authProvider: AuthProvider.CREDENTIAL,
			},
		});

		// A credential based user tries Google Auth
		if (ifPatientExistWithCredentials) {
			if (!ifPatientExistWithCredentials.emailVerified) {
				throw new Error("User Email Not Verified");
			}

			if (ifPatientExistWithCredentials.status === UserStatus.BLOCKED) {
				throw new Error("User Is Blocked");
			}

			if (
				ifPatientExistWithCredentials.isDeleted ||
				ifPatientExistWithCredentials.status === UserStatus.DELETED
			) {
				throw new Error("User Is Deleted");
			}

			user = await prisma.user.update({
				where: {
					id: ifPatientExistWithCredentials.id,
				},
				data: {
					googleId: googleIdTokenPayload.sub,
				},
			});
		} else {
			// Google Auth register
			user = await prisma.user.create({
				data: {
					email: googleIdTokenPayload.email,
					name: googleIdTokenPayload.name,
					role: Role.PATIENT,
					googleId: googleIdTokenPayload.sub,
					authProvider: AuthProvider.GOOGLE,
					emailVerified: true,
					patient: {
						create: {
							name: googleIdTokenPayload.name,
							email: googleIdTokenPayload.email,
						},
					},
				},
			});
		}
	}

	if (!user) {
		throw new Error("User Not Found");
	}

	//All tries fails to find user in system
	if (user.status === UserStatus.BLOCKED) {
		throw new Error("User Is Blocked");
	}

	if (user.isDeleted || user.status === UserStatus.DELETED) {
		throw new Error("User Is Deleted");
	}

	const jwtPayload = {
		userId: user.id,
		name: user.name,
		email: user.email,
		role: user.role,
	};

	const accessToken = jwtUtils.createToken(
		jwtPayload,
		config.jwt_access_secret,
		config.jwt_access_expires_in as SignOptions,
	);

	const refreshToken = jwtUtils.createToken(
		jwtPayload,
		config.jwt_refresh_secret,
		config.jwt_refresh_expires_in as SignOptions,
	);

	return {
		accessToken,
		refreshToken,
	};
};

const forgotPassword = async (payload: IForgotPasswordPayload) => {
	const { email } = payload;
	const isUserExists = await prisma.user.findUnique({
		where: {
			email: email,
		},
	});

	if (!isUserExists) {
		throw new Error("User Does Not Exist.");
	}

	if (!isUserExists.emailVerified) {
		throw new Error("User Does Not Have a Verified Email.");
	}

	if (isUserExists.status === "BLOCKED") {
		throw new Error("User Account Is Blocked.");
	}

	if (isUserExists.isDeleted || isUserExists.status === "DELETED") {
		throw new Error("User Account Is Deleted.");
	}

	if (isUserExists.googleId && isUserExists.authProvider === "GOOGLE") {
		throw new Error("User Account Registered with Google.");
	}

	const otp = crypto.randomInt(100000, 1000000).toString();
	const key = `forgot-password-otp:${isUserExists.email}`;

	await redisClient.set(key, otp, {
		expiration: {
			type: "EX",
			value: 5 * 60,
		},
	});
	const templatePath = path.join(
		process.cwd(),
		"src/app/templates/forgot-password.ejs",
	);
	const html = await ejs.renderFile(templatePath, {
		name: isUserExists.name,
		otp: otp,
		expiration: 5,
	});

	await transporter.sendMail(
		{
			from: config.email_sender,
			to: isUserExists.email,
			subject: "Forgot Password",
			// text: `Your OTP is ${otp}`,
			html: html,
		},
		(error, info) => {
			if (error) {
				console.log("Error Sending OTP Email: ", error);
			}
			console.log("Email sent: %s", info.messageId);
		},
	);
};

const resetPassword = async (payload: IResetPasswordPayload) => {
	const { email, otp, newPassword } = payload;
	const isUserExists = await prisma.user.findUnique({
		where: {
			email: email,
		},
	});

	if (!isUserExists) {
		throw new Error("User Does Not Exist.");
	}

	if (!isUserExists.emailVerified) {
		throw new Error("User Does Not Have a Verified Email.");
	}

	if (isUserExists.status === "BLOCKED") {
		throw new Error("User Account Is Blocked.");
	}

	if (isUserExists.isDeleted || isUserExists.status === "DELETED") {
		throw new Error("User Account Is Deleted.");
	}

	if (isUserExists.googleId && isUserExists.authProvider === "GOOGLE") {
		throw new Error("User Account Registered with Google.");
	}
	const key = `forgot-password-otp:${isUserExists.email}`;
	const redisOtp = await redisClient.get(key);

	if (!redisOtp) {
		throw new Error("Invalid OTP");
	}

	if (redisOtp !== otp) {
		throw new Error("OTP does not match.");
	}

	const hashedNewPassword = await bcrypt.hash(
		newPassword,
		Number(config.bcrypt_salt_rounds),
	);

	await prisma.user.update({
		where: {
			email: isUserExists.email,
		},
		data: {
			password: hashedNewPassword,
		},
	});

	await redisClient.del([key]);
	const templatePath = path.join(
		process.cwd(),
		"src/app/templates/reset-password-success.ejs",
	);
	const html = await ejs.renderFile(templatePath, {
		name: isUserExists.name,
		otp: otp,
		expiration: 5,
	});
	await transporter.sendMail({
		from: config.email_sender,
		to: isUserExists.email,
		subject: "Password Updated",
		// text: `Your OTP is ${otp}`,
		html: html,
	});
};

const verifyUserEmail = async (payload: IVerfiyUserEmailPayload) => {
	const email = payload.email.trim().toLowerCase();
	const otp = payload.otp;
	const isUserExists = await prisma.user.findUnique({
		where: {
			email: email,
		},
	});

	if (isUserExists?.emailVerified) {
		throw new Error("Already a Verified Email.");
	}

	if (isUserExists?.status === "BLOCKED") {
		throw new Error("User Account Is Blocked.");
	}

	if (isUserExists?.isDeleted || isUserExists?.status === "DELETED") {
		throw new Error("User Account Is Deleted.");
	}

	const otpKey = `patient-registration-otp:${email}`;
	const redisOtp = await redisClient.get(otpKey);

	if (!redisOtp) {
		throw new Error("Invalid OTP");
	}

	if (redisOtp !== otp) {
		throw new Error("OTP does not match.");
	}
	await redisClient.del(otpKey);

	const patientRegistrationKey = `patient-registration-data:${email}`;
	const redisPatientData = await redisClient.get(patientRegistrationKey);
	if (!redisPatientData) {
		throw new Error("Patient does not exist.");
	}
	const patientPayload: IRegisterPatientPayload = JSON.parse(redisPatientData);
	// Store user in DB
	const createdUser = await prisma.user.create({
		data: {
			name: patientPayload.name,
			email: patientPayload.email,
			password: patientPayload.password,
			role: Role.PATIENT,
			status: UserStatus.ACTIVE,
			emailVerified: true,
			patient: {
				create: {
					name: patientPayload.name,
					email: patientPayload.email,
					contactNumber: patientPayload.patient?.contactNumber || "",
				},
			},
		},
		omit: { password: true },
		include: { patient: true },
	});

	// Send Welcome Email
	const templatePath = path.join(
		process.cwd(),
		"src/app/templates/welcome-email.ejs",
	);
	const html = await ejs.renderFile(templatePath, {
		name: createdUser.name,
	});

	await transporter.sendMail(
		{
			from: config.email_sender,
			to: email,
			subject: "Welcome to Algo E-Health System",
			html: html,
		},
		(error, info) => {
			if (error) {
				console.log("Error Sending Welcome Email: ", error);
			}
			console.log("Welcome Email sent: %s", info.messageId);
		},
	);

	await redisClient.del(patientRegistrationKey);

	const { patient, ...user } = createdUser;
	const jwtPayload = {
		userId: user.id,
		name: user.name,
		email: user.email,
		role: user.role,
	};

	const accessToken = jwtUtils.createToken(
		jwtPayload,
		config.jwt_access_secret,
		config.jwt_access_expires_in as SignOptions,
	);

	const refreshToken = jwtUtils.createToken(
		jwtPayload,
		config.jwt_refresh_secret,
		config.jwt_refresh_expires_in as SignOptions,
	);

	return {
		user,
		patient,
		accessToken,
		refreshToken,
	};
};

export const AuthService = {
	registerPatient,
	loginUser,
	getMe,
	refreshToken,
	gogleAuth,
	forgotPassword,
	resetPassword,
	verifyUserEmail,
};
