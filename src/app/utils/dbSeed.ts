import bcrypt from "bcryptjs";
import { Role } from "../../generated/prisma/enums";
import { prisma } from "../lib/prisma";
import config from "../config";

export const seedAdmin = async () => {
	try {
		const isAdminExists = await prisma.user.findFirst({
			where: {
				role: Role.ADMIN,
			},
		});

		if (isAdminExists) {
			console.log("Admin Already Exists.");
			return;
		}
		const name = config.admin_name;
		const email = config.admin_email;
		const password = config.admin_password;

		if (!name || !email || !password) {
			throw new Error("Admin Details Missing in .env file.");
		}

		const hashedPassword = await bcrypt.hash(
			password,
			Number(config.bcrypt_salt_rounds),
		);

		const admin = await prisma.user.create({
			data: {
				name,
				email,
				password: hashedPassword,
				role: Role.ADMIN,
				needPasswordChange: false,
				emailVerified: true,
			},
		});

		console.log("Admin Created: ", admin);
	} catch (error) {
		console.log("Error seeding Admin : ", error);

		await prisma.user.delete({
			where: {
				email: config.admin_email,
			},
		});
	}
};

export const seedSuperAdmin = async () => {
	try {
		const isAdminExists = await prisma.user.findFirst({
			where: {
				role: Role.SUPER_ADMIN,
			},
		});

		if (isAdminExists) {
			console.log("Super Admin Already Exists.");
			return;
		}
		const name = config.super_admin_name;
		const email = config.super_admin_email;
		const password = config.super_admin_password;

		if (!name || !email || !password) {
			throw new Error("Super Admin Details Missing in .env file.");
		}

		const hashedPassword = await bcrypt.hash(
			password,
			Number(config.bcrypt_salt_rounds),
		);

		const superAdmin = await prisma.user.create({
			data: {
				name,
				email,
				password: hashedPassword,
				role: Role.SUPER_ADMIN,
				needPasswordChange: false,
				emailVerified: true,
			},
		});

		console.log("Super Admin Created: ", superAdmin);
	} catch (error) {
		console.log("Error seeding Super Admin : ", error);

		await prisma.user.delete({
			where: {
				email: config.super_admin_email,
			},
		});
	}
};

export const seedTestPatient = async () => {
	try {
		const isTestPatientExists = await prisma.user.findFirst({
			where: {
				role: Role.PATIENT,
			},
		});

		if (isTestPatientExists) {
			console.log("Test Patient Already Exists.");
			return;
		}
		const name = config.test_patient_name;
		const email = config.test_patient_email;
		const password = config.test_patient_password;

		if (!name || !email || !password) {
			throw new Error("Test Patient Details Missing in .env file.");
		}

		const hashedPassword = await bcrypt.hash(
			password,
			Number(config.bcrypt_salt_rounds),
		);

		const testPatient = await prisma.user.create({
			data: {
				name,
				email,
				password: hashedPassword,
				role: Role.PATIENT,
				needPasswordChange: false,
				emailVerified: true,
				patient: {
					create: { name, email },
				},
			},
		});

		console.log("Test Patient Created: ", testPatient);
	} catch (error) {
		console.log("Error Seeding Test Patient : ", error);

		await prisma.user.delete({
			where: {
				email: config.test_patient_email,
			},
		});
	}
};

export const seedTestDoctor = async () => {
	try {
		const isTestDoctorExists = await prisma.user.findFirst({
			where: {
				role: Role.DOCTOR,
			},
		});

		if (isTestDoctorExists) {
			console.log("Test Doctor Already Exists.");
			return;
		}
		const name = config.test_doctor_name;
		const email = config.test_doctor_email;
		const password = config.test_doctor_password;

		if (!name || !email || !password) {
			throw new Error("Test Doctor Details Missing in .env file.");
		}

		const hashedPassword = await bcrypt.hash(
			password,
			Number(config.bcrypt_salt_rounds),
		);

		const testDoctor = await prisma.user.create({
			data: {
				name,
				email,
				password: hashedPassword,
				role: Role.DOCTOR,
				needPasswordChange: false,
				emailVerified: true,
			},
		});

		console.log("Test Doctor Created: ", testDoctor);
	} catch (error) {
		console.log("Error Seeding Test Doctor : ", error);

		await prisma.user.delete({
			where: {
				email: config.test_doctor_email,
			},
		});
	}
};
