import { Router } from "express";
import { Role } from "../../../generated/prisma/enums";
import { auth } from "../../middleware/checkAuth";
import { AuthController } from "./auth.controller";
import { UserValidation } from "./auth.validation";
import zodValidation from "../../middleware/zodValidation";

const router = Router();

router.post(
	"/register",
	zodValidation(UserValidation.PatientRegistrationZodSchema),
	AuthController.registerPatient,
);
router.post(
	"/login",
	zodValidation(UserValidation.PatientLoginZodSchema),
	AuthController.loginUser,
);
router.get(
	"/me",
	auth(Role.ADMIN, Role.DOCTOR, Role.PATIENT, Role.SUPER_ADMIN),
	AuthController.getMe,
);
router.post("/refresh-token", AuthController.refreshToken);
router.post("/google", AuthController.gooleAuth);
router.post(
	"/forgot-password",
	zodValidation(UserValidation.ForgotPasswordZodSchema),
	AuthController.forgotPassword,
);
router.post(
	"/reset-password",
	zodValidation(UserValidation.ResetPasswordZodSchema),
	AuthController.resetPassword,
);
router.post(
	"/verify-email",
	zodValidation(UserValidation.UserEmailVerificationZodSchema),
	AuthController.verifyUserEmail,
);
export const AuthRoutes = router;
